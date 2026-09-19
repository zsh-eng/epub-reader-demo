"""Fit FSRS-6 locally from a read-only Spaced backup; never modifies the database.

Requires fsrs-optimizer==6.5.0. Raw history and reports belong in a Git-ignored
output directory. Uses an independent chronological holdout before a full fit.
"""
import argparse
import csv
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

os.environ.setdefault('MPLBACKEND', 'Agg')
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('MPLCONFIGDIR', str(Path('optimizer.local/matplotlib').resolve()))
import numpy as np
import pandas as pd
import torch
from fsrs_optimizer import Optimizer, Collection, DEFAULT_PARAMETER, lineToTensor, power_forgetting_curve

torch.set_num_threads(2)
torch.manual_seed(42)
np.random.seed(42)
RATINGS = {'Manual': 0, 'Again': 1, 'Hard': 2, 'Good': 3, 'Easy': 4}

def fit(rows, folder):
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / 'revlog.csv').open('w') as f:
        w = csv.writer(f)
        w.writerow(['card_id', 'review_time', 'review_rating'])
        w.writerows((r['card_id'], r['review'], RATINGS[r['grade']]) for r in rows)
    previous = Path.cwd()
    try:
        os.chdir(folder)
        opt = Optimizer(enable_short_term=True)
        opt.create_time_series('Asia/Singapore', '2006-10-05', 4, analysis=False)
        opt.define_model()
        opt.initialize_parameters(verbose=False)
        opt.train(verbose=False, recency_weight=True)
        losses = opt.evaluate(save_to_file=False)
        result = {'weights': opt.w, 'training_targets': len(opt.dataset),
                  'weighted_training_loss_default': float(losses[0]),
                  'weighted_training_loss_fitted': float(losses[1])}
        assert len(opt.w) == 21 and all(np.isfinite(opt.w))
        (folder / 'fit.json').write_text(json.dumps(result, indent=2))
        return result
    finally:
        os.chdir(previous)

def holdout(rows, cutoff):
    # Build history only from prior answers. Manual entries invalidate subsequent
    # history, matching the official optimizer; never treat Manual as recall.
    histories = {}
    targets = []
    for row in rows:
        key = row['card_id']
        day = (datetime.fromtimestamp(row['review']/1000, ZoneInfo('Asia/Singapore'))
               - timedelta(hours=4)).date().toordinal()
        rating = RATINGS[row['grade']]
        h = histories.setdefault(key, {'days': [], 'ratings': [], 'last': day, 'manual': False})
        delta = day - h['last'] if h['ratings'] else 0
        assert delta >= 0
        if row['review'] > cutoff and delta > 0 and h['ratings'] and not h['manual'] and rating:
            targets.append({'t_history': ','.join(map(str,h['days'])),
                            'r_history': ','.join(map(str,h['ratings'])),
                            'delta_t': delta, 'y': int(rating != 1)})
        h['days'].append(delta); h['ratings'].append(rating); h['last'] = day
        h['manual'] = h['manual'] or rating == 0
    data = pd.DataFrame(targets)
    assert len(data) > 100
    data['tensor'] = data.apply(lambda r: lineToTensor((r.t_history, r.r_history)),axis=1)
    return data

def score(data, weights):
    # Bound peak memory for long histories. No parameter fitting here.
    predictions = []
    model = Collection(weights)
    for start in range(0,len(data),512):
        batch=data.iloc[start:start+512]
        stability,_=model.batch_predict(batch)
        predictions.extend(power_forgetting_curve(batch.delta_t.to_numpy(),np.array(stability),-weights[20]))
    p=np.clip(np.array(predictions),1e-7,1-1e-7); y=data.y.to_numpy()
    return {'log_loss':float(np.mean(-y*np.log(p)-(1-y)*np.log(1-p))),
            'brier':float(np.mean((p-y)**2)), 'mean_predicted_recall':float(p.mean()),
            'observed_recall':float(y.mean()), 'targets':len(data)}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args(); output=args.output.resolve(); output.mkdir(parents=True,exist_ok=True)
    assert importlib.metadata.version('fsrs-optimizer') == '6.5.0'
    db=sqlite3.connect(args.database.resolve().as_uri()+'?mode=ro',uri=True); db.row_factory=sqlite3.Row
    users=db.execute('select user_id,count(*) n from review_logs group by user_id order by n desc').fetchall()
    assert users[0]['n'] > 10*users[1]['n'], 'Select account explicitly if activity is ambiguous'
    user=users[0]['user_id']
    raw=db.execute('select * from review_logs where user_id=? order by review,id',(user,)).fetchall()
    rows=db.execute('''select r.* from review_logs r where r.user_id=? and not exists
        (select 1 from review_log_deleted d where d.user_id=r.user_id and d.review_log_id=r.id and d.deleted=1)
        order by r.review,r.id''',(user,)).fetchall()
    assert all(r['grade'] in RATINGS and r['review'] > 0 for r in rows)
    # A missing first-learning review means the initial memory state is unknown.
    first={}
    for r in rows: first.setdefault(r['card_id'],r['state'])
    eligible={key for key,state in first.items() if state=='New'}
    clean=[r for r in rows if r['card_id'] in eligible]
    cutoff=clean[int(len(clean)*0.8)]['review']
    train=[r for r in clean if r['review']<=cutoff]
    audit={'source_sha256':hashlib.sha256(args.database.read_bytes()).hexdigest(),
           'optimizer':'fsrs-optimizer==6.5.0','algorithm':'FSRS-6','timezone':'Asia/Singapore','day_start':4,
           'raw_reviews':len(raw),'undone_excluded':len(raw)-len(rows),
           'unknown_initial_state_reviews_excluded':len(rows)-len(clean),
           'exported_reviews':len(clean),'cards':len(eligible),
           'manual_markers':sum(r['grade']=='Manual' for r in clean),
           'manual_policy':'Official optimizer excludes manual and all subsequent targets for that card',
           'hard_policy':'Hard is successful recall with effort, confirmed by user',
           'holdout_cutoff_ms':cutoff,'training_input_reviews':len(train)}
    (output/'audit.json').write_text(json.dumps(audit,indent=2))
    print('Fitting chronological training partition',flush=True)
    partial=fit(train,output/'training')
    data=holdout(clean,cutoff)
    validation={'default':score(data,DEFAULT_PARAMETER),'fitted':score(data,partial['weights']),
                'method':'Earlier 80% timestamps train; later next-day targets test, with prior history available; no test outlier filtering'}
    (output/'holdout.json').write_text(json.dumps(validation,indent=2))
    print('Holdout:',json.dumps(validation),flush=True)
    print('Fitting all eligible history',flush=True)
    full=fit(clean,output/'full')
    result={**audit,'validation':validation,'full_fit':full}
    (output/'result.json').write_text(json.dumps(result,indent=2))
    print('DONE',json.dumps(full),flush=True)

if __name__=='__main__': main()
