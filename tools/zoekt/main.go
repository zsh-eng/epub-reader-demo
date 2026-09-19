// med-zoekt exposes a small, source-bound search API over a private Unix socket.
// It does not parse user text as Zoekt query syntax or run Git subprocesses.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/sourcegraph/zoekt"
	"github.com/sourcegraph/zoekt/query"
	"github.com/sourcegraph/zoekt/search"
)

const version = "v0.0.0-20260911061844-153817f643cd"
const maxResponseBytes = 1 << 20

var commitPattern = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)

type branchInfo struct {
	Name   string `json:"name"`
	Commit string `json:"commit"`
}
type healthResponse struct {
	Branches []branchInfo `json:"branches"`
	Version  string       `json:"version"`
}
type searchRequest struct {
	Branch string `json:"branch"`
	Commit string `json:"commit"`
	Query  string `json:"query"`
}
type match struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}
type searchResponse struct {
	Matches   []match `json:"matches"`
	Truncated bool    `json:"truncated"`
}
type service struct {
	searcher zoekt.Searcher
	slots    chan struct{}
}

func main() {
	index := flag.String("index", "", "Directory containing one repository's Zoekt index")
	socket := flag.String("socket", "", "Unix socket in an existing private directory")
	lock := flag.String("lock", "", "Hold an exclusive repository cache lock until stdin closes")
	flag.Parse()
	if *lock != "" {
		if *index != "" || *socket != "" || flag.NArg() != 0 {
			log.Fatal("Use --lock <path> without other arguments.")
		}
		if err := runLock(*lock); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *index == "" || *socket == "" || flag.NArg() != 0 {
		log.Fatal("Use --index <directory> --socket <path>.")
	}
	if err := run(*index, *socket); err != nil {
		log.Fatal(err)
	}
}

func acquireFileLock(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, fmt.Errorf("open cache lock: %w", err)
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, errors.New("the cache lock must be a regular file")
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("another viewer owns this cache lock: %w", err)
	}
	return file, nil
}

func runLock(path string) error {
	file, err := acquireFileLock(path)
	if err != nil {
		return err
	}
	// Never unlink this file: every contender must lock the same inode.
	// Closing the descriptor or a process crash releases the kernel lock.
	defer file.Close()
	if _, err := fmt.Fprintln(os.Stdout, "locked"); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	<-ctx.Done()
	return nil
}

func run(index, socket string) error {
	parent, err := os.Stat(filepath.Dir(socket))
	if err != nil || !parent.IsDir() || parent.Mode().Perm()&0077 != 0 {
		return errors.New("the socket parent must be an existing private directory (mode 0700)")
	}
	// Loading is synchronous: health never reports readiness before shards load.
	searcher, err := search.NewDirectorySearcher(index)
	if err != nil {
		return fmt.Errorf("load search index: %w", err)
	}
	defer searcher.Close()
	svc := &service{searcher: searcher, slots: make(chan struct{}, 2)}
	if _, _, err := svc.metadata(context.Background()); err != nil {
		return err
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return fmt.Errorf("listen on private socket: %w", err)
	}
	defer listener.Close()
	defer os.Remove(socket)
	if err := os.Chmod(socket, 0600); err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", svc.health)
	mux.HandleFunc("POST /search", svc.search)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 8 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Node holds stdin open. EOF also stops the helper after a parent crash.
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
		}
		return nil
	case err := <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// Read loaded shard metadata for every request. Never trust a sidecar manifest.
func (s *service) metadata(ctx context.Context) (string, []branchInfo, error) {
	listed, err := s.searcher.List(ctx, &query.Const{Value: true}, &zoekt.ListOptions{})
	if err != nil {
		return "", nil, err
	}
	if listed.Crashes != 0 {
		return "", nil, errors.New("index metadata is unavailable")
	}
	repository, source := "", ""
	versions := make(map[string]string)
	for _, entry := range listed.Repos {
		if repository == "" {
			repository, source = entry.Repository.Name, entry.Repository.Source
		}
		if repository != entry.Repository.Name || source != entry.Repository.Source {
			return "", nil, errors.New("each index must contain exactly one repository")
		}
		for _, branch := range entry.Repository.Branches {
			if old, ok := versions[branch.Name]; ok && old != branch.Version {
				return "", nil, errors.New("index contains mixed branch versions")
			}
			versions[branch.Name] = branch.Version
		}
	}
	branches := make([]branchInfo, 0, len(versions))
	for name, commit := range versions {
		branches = append(branches, branchInfo{name, commit})
	}
	sort.Slice(branches, func(i, j int) bool { return branches[i].Name < branches[j].Name })
	return repository, branches, nil
}

func (s *service) health(w http.ResponseWriter, r *http.Request) {
	_, branches, err := s.metadata(r.Context())
	if err != nil {
		fail(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, healthResponse{branches, version})
}

func (s *service) selected(ctx context.Context, request searchRequest) (string, error) {
	repo, branches, err := s.metadata(ctx)
	if err != nil {
		return "", err
	}
	for _, branch := range branches {
		if branch.Name == request.Branch && branch.Commit == request.Commit {
			return repo, nil
		}
	}
	return "", errors.New("the selected branch version is not loaded; rebuild its search index")
}

func (s *service) search(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request searchRequest
	if err := decoder.Decode(&request); err != nil {
		fail(w, 400, "Invalid search request.")
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "Use one JSON request.")
		return
	}
	if len(request.Branch) == 0 || len(request.Branch) > 4096 || strings.ContainsAny(request.Branch, "\x00\r\n") || !commitPattern.MatchString(request.Commit) || !utf8.ValidString(request.Query) || utf8.RuneCountInString(request.Query) < 1 || utf8.RuneCountInString(request.Query) > 256 || strings.ContainsAny(request.Query, "\x00\r\n") {
		fail(w, 400, "Use a branch, full commit ID, and one line of literal search text (1–256 characters).")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		fail(w, 503, "Search is busy.")
		return
	}
	repository, err := s.selected(ctx, request)
	if err != nil {
		fail(w, 409, err.Error())
		return
	}
	// Content and branch are structured atoms. User query syntax is always literal.
	q := &query.And{Children: []query.Q{&query.Branch{Pattern: request.Branch, Exact: true}, &query.Substring{Pattern: request.Query, Content: true, CaseSensitive: false}}}
	result, err := s.searcher.Search(ctx, q, &zoekt.SearchOptions{ShardMaxMatchCount: 1000, TotalMaxMatchCount: 1000, MaxDocDisplayCount: 201, MaxMatchDisplayCount: 201, MaxWallTime: 3 * time.Second})
	if err != nil {
		fail(w, 503, "The indexed search could not complete.")
		return
	}
	if result.Crashes != 0 {
		fail(w, 503, "The indexed search could not complete.")
		return
	}
	if _, err := s.selected(ctx, request); err != nil {
		fail(w, 409, err.Error())
		return
	}
	response := searchResponse{Matches: make([]match, 0), Truncated: result.FilesSkipped > 0 || result.ShardsSkipped > 0 || result.MatchCount > 201}
	bytes := 64
	seen := make(map[string]map[int]bool)
outer:
	for _, file := range result.Files {
		if file.Repository != repository || file.SubRepositoryPath != "" || !safePath(file.FileName) {
			response.Truncated = true
			continue
		}
		if seen[file.FileName] == nil {
			seen[file.FileName] = make(map[int]bool)
		}
		for _, line := range file.LineMatches {
			if line.FileName {
				continue
			}
			if line.LineNumber < 1 || line.LineNumber > 200000 {
				response.Truncated = true
				continue
			}
			if seen[file.FileName][line.LineNumber] {
				continue
			}
			seen[file.FileName][line.LineNumber] = true
			if len(response.Matches) == 200 {
				response.Truncated = true
				break outer
			}
			entry := match{file.FileName, line.LineNumber, snippet(line)}
			encoded, _ := json.Marshal(entry)
			if bytes+len(encoded)+1 > maxResponseBytes {
				response.Truncated = true
				break outer
			}
			bytes += len(encoded) + 1
			response.Matches = append(response.Matches, entry)
		}
	}
	writeJSON(w, response)
}

func safePath(name string) bool {
	if name == "" || len(name) > 4096 || !utf8.ValidString(name) || strings.ContainsRune(name, 0) || path.IsAbs(name) || path.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".git" || part == ".." || part == "." {
			return false
		}
	}
	return true
}

func snippet(line zoekt.LineMatch) string {
	text := strings.TrimRight(strings.ToValidUTF8(string(line.Line), "�"), "\r\n")
	runes := []rune(text)
	if len(runes) <= 1000 {
		return text
	}
	start := 0
	if len(line.LineFragments) > 0 {
		offset := line.LineFragments[0].LineOffset
		if offset > 0 && offset < len(text) {
			start = max(0, utf8.RuneCountInString(text[:offset])-100)
		}
	}
	start = min(start, len(runes)-998)
	end := min(len(runes), start+998)
	prefix, suffix := "", ""
	if start > 0 {
		prefix = "…"
	}
	if end < len(runes) {
		suffix = "…"
	}
	return prefix + string(runes[start:end]) + suffix
}

func fail(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": message}})
}
func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
