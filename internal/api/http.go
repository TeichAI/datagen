package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"datagen/gitserver/internal/repository"
	"github.com/go-chi/chi/v5"
)

type Server struct {
	httpServer    *http.Server
	repositorySvc *repository.Service
	masterKey     string
	timeout       time.Duration
}

type createRepositoryRequest struct {
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

func NewServer(addr string, timeout time.Duration, masterKey string, repositorySvc *repository.Service) *Server {
	r := chi.NewRouter()
	s := &Server{
		repositorySvc: repositorySvc,
		masterKey:     masterKey,
		timeout:       timeout,
	}
	r.Get("/healthz", s.health)
	r.Route("/v1", func(r chi.Router) {
		r.Post("/repositories", s.requireMasterKey(s.createRepository))
		r.Get("/repositories/{owner}/{name}", s.getRepository)
		r.Put("/repositories/{owner}/{name}/objects/{objectPath...}", s.requireMasterKey(s.putObject))
		r.Get("/repositories/{owner}/{name}/objects/{objectPath...}", s.getObject)
		r.Get("/repositories/{owner}/{name}/tree", s.listObjects)
	})
	s.httpServer = &http.Server{
		Addr:    addr,
		Handler: r,
	}
	return s
}

func (s *Server) Start() error {
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) withTimeout(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), s.timeout)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) createRepository(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.withTimeout(r)
	defer cancel()
	var req createRepositoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Owner = strings.TrimSpace(req.Owner)
	req.Name = strings.TrimSpace(req.Name)
	if req.Owner == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "owner and name are required")
		return
	}
	repo, err := s.repositorySvc.CreateRepository(ctx, req.Owner, req.Name)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			writeError(w, http.StatusConflict, "repository already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create repository")
		return
	}
	writeJSON(w, http.StatusCreated, repo)
}

func (s *Server) getRepository(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.withTimeout(r)
	defer cancel()
	owner := chi.URLParam(r, "owner")
	name := chi.URLParam(r, "name")
	repo, err := s.repositorySvc.GetRepository(ctx, owner, name)
	if err != nil {
		if repository.IsNotFound(err) {
			writeError(w, http.StatusNotFound, "repository not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to fetch repository")
		return
	}
	writeJSON(w, http.StatusOK, repo)
}

func (s *Server) putObject(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.withTimeout(r)
	defer cancel()
	owner := chi.URLParam(r, "owner")
	name := chi.URLParam(r, "name")
	objectPath := strings.TrimPrefix(chi.URLParam(r, "objectPath"), "/")
	if objectPath == "" {
		writeError(w, http.StatusBadRequest, "object path is required")
		return
	}
	if err := s.repositorySvc.PutObject(ctx, owner, name, objectPath, r.Body, r.ContentLength); err != nil {
		if repository.IsNotFound(err) {
			writeError(w, http.StatusNotFound, "repository not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to store object")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"path": objectPath})
}

func (s *Server) getObject(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.withTimeout(r)
	defer cancel()
	owner := chi.URLParam(r, "owner")
	name := chi.URLParam(r, "name")
	objectPath := strings.TrimPrefix(chi.URLParam(r, "objectPath"), "/")
	obj, info, err := s.repositorySvc.GetObject(ctx, owner, name, objectPath)
	if err != nil {
		if repository.IsNotFound(err) {
			writeError(w, http.StatusNotFound, "repository or object not found")
			return
		}
		if strings.Contains(err.Error(), "does not exist") {
			writeError(w, http.StatusNotFound, "object not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to fetch object")
		return
	}
	defer obj.Close()
	if info.ContentType != "" {
		w.Header().Set("Content-Type", info.ContentType)
	}
	w.Header().Set("ETag", info.ETag)
	w.Header().Set("Last-Modified", info.LastModified.UTC().Format(http.TimeFormat))
	w.WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(w, obj)
	if copyErr != nil && !errors.Is(copyErr, context.Canceled) {
		return
	}
}

func (s *Server) listObjects(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.withTimeout(r)
	defer cancel()
	owner := chi.URLParam(r, "owner")
	name := chi.URLParam(r, "name")
	prefix := strings.TrimPrefix(r.URL.Query().Get("prefix"), "/")
	objects, err := s.repositorySvc.ListObjects(ctx, owner, name, prefix)
	if err != nil {
		if repository.IsNotFound(err) {
			writeError(w, http.StatusNotFound, "repository not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to list objects")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": objects})
}

func (s *Server) requireMasterKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Master-Key") != s.masterKey {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
