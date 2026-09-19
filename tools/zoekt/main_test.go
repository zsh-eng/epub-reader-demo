package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/sourcegraph/zoekt"
	"github.com/sourcegraph/zoekt/query"
)

const testCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type fakeSearcher struct {
	q        query.Q
	result   *zoekt.SearchResult
	branches []zoekt.RepositoryBranch
}

func (f *fakeSearcher) Search(_ context.Context, q query.Q, _ *zoekt.SearchOptions) (*zoekt.SearchResult, error) {
	f.q = q
	return f.result, nil
}
func (f *fakeSearcher) List(context.Context, query.Q, *zoekt.ListOptions) (*zoekt.RepoList, error) {
	return &zoekt.RepoList{Repos: []*zoekt.RepoListEntry{{Repository: zoekt.Repository{Name: "test", Source: "/fixture", Branches: f.branches}}}}, nil
}
func (f *fakeSearcher) Close()         {}
func (f *fakeSearcher) String() string { return "test" }
func fixture() (*service, *fakeSearcher) {
	f := &fakeSearcher{result: &zoekt.SearchResult{}, branches: []zoekt.RepositoryBranch{{Name: "main", Version: testCommit}}}
	return &service{searcher: f, slots: make(chan struct{}, 2)}, f
}
func requestSearch(s *service, q searchRequest) *httptest.ResponseRecorder {
	encoded, _ := json.Marshal(q)
	r := httptest.NewRequest("POST", "/search", strings.NewReader(string(encoded)))
	w := httptest.NewRecorder()
	s.search(w, r)
	return w
}

func TestQueryIsLiteralAndBranchIsExact(t *testing.T) {
	s, f := fixture()
	w := requestSearch(s, searchRequest{"main", testCommit, "repo:other OR branch:other"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	and, ok := f.q.(*query.And)
	if !ok || len(and.Children) != 2 {
		t.Fatalf("expected two structured atoms, got %#v", f.q)
	}
	branch := and.Children[0].(*query.Branch)
	content := and.Children[1].(*query.Substring)
	if !branch.Exact || branch.Pattern != "main" || content.Pattern != "repo:other OR branch:other" || !content.Content || content.CaseSensitive {
		t.Fatal(f.q)
	}
}

func TestDifferentCommitCannotSearch(t *testing.T) {
	s, f := fixture()
	w := requestSearch(s, searchRequest{"main", strings.Repeat("b", 40), "needle"})
	if w.Code != 409 || f.q != nil {
		t.Fatalf("stale source was searched: %d %#v", w.Code, f.q)
	}
}

func TestResultsAreBoundedAndPathsAreSafe(t *testing.T) {
	s, f := fixture()
	lines := make([]zoekt.LineMatch, 250)
	for i := range lines {
		lines[i] = zoekt.LineMatch{LineNumber: i + 1, Line: []byte(strings.Repeat("界", 3000)), LineFragments: []zoekt.LineFragmentMatch{{LineOffset: 6000, MatchLength: 3}}}
	}
	f.result.Files = []zoekt.FileMatch{{Repository: "test", FileName: "../outside", LineMatches: lines}, {Repository: "test", FileName: "src/example.ts", LineMatches: lines}}
	w := requestSearch(s, searchRequest{"main", testCommit, "界"})
	var result searchResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Matches) != 200 || !result.Truncated || w.Body.Len() > maxResponseBytes {
		t.Fatal(len(result.Matches), result.Truncated, w.Body.Len())
	}
	for _, m := range result.Matches {
		if m.Path != "src/example.ts" || utf8.RuneCountInString(m.Text) > 1000 {
			t.Fatal(m)
		}
	}
}

func TestInvalidQueryNeverReachesSearcher(t *testing.T) {
	for _, value := range []string{"", "one\ntwo", strings.Repeat("x", 257)} {
		s, f := fixture()
		w := requestSearch(s, searchRequest{"main", testCommit, value})
		if w.Code != 400 || f.q != nil {
			t.Fatalf("invalid query searched: %q", value)
		}
	}
}

func TestHealthReflectsLoadedBranches(t *testing.T) {
	s, f := fixture()
	f.branches = append(f.branches, zoekt.RepositoryBranch{Name: "feature", Version: strings.Repeat("b", 40)})
	w := httptest.NewRecorder()
	s.health(w, httptest.NewRequest("GET", "/health", nil))
	var result healthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Branches) != 2 || result.Version != version || result.Branches[0].Name != "feature" || result.Branches[1].Commit != testCommit {
		t.Fatal(result)
	}
}

func TestSafePathRejectsIndexEscape(t *testing.T) {
	for _, name := range []string{"", "/absolute", "../escape", "a/../b", ".git/config", "a/.git/config", "a//b"} {
		if safePath(name) {
			t.Fatalf("accepted unsafe path %q", name)
		}
	}
	if !safePath("src/name with spaces.ts") {
		t.Fatal("valid path rejected")
	}
}

func TestCacheLockExcludesOtherOwnersAndKeepsTheInode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writer.lock")
	first, err := acquireFileLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	before, err := first.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireFileLock(path); err == nil {
		second.Close()
		t.Fatal("another descriptor acquired an owned lock")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	third, err := acquireFileLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer third.Close()
	after, err := third.Stat()
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("lock inode changed", err)
	}
	if after.Mode().Perm() != 0600 {
		t.Fatal("lock mode", after.Mode().Perm())
	}
}
