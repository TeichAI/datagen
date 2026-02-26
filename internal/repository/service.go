package repository

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"path/filepath"

	"datagen/gitserver/internal/db"
	"datagen/gitserver/internal/domain"
	"github.com/minio/minio-go/v7"
)

type repositoryStore interface {
	CreateRepository(ctx context.Context, owner string, name string) (domain.Repository, error)
	GetRepository(ctx context.Context, owner string, name string) (domain.Repository, error)
}

type repositoryCache interface {
	SetRepository(ctx context.Context, repo domain.Repository) error
	GetRepository(ctx context.Context, owner string, name string) (domain.Repository, bool, error)
}

type objectStore interface {
	PutObject(ctx context.Context, owner string, repo string, objectPath string, body io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, owner string, repo string, objectPath string) (*minio.Object, minio.ObjectInfo, error)
	ListObjects(ctx context.Context, owner string, repo string, prefix string) ([]domain.ObjectMeta, error)
}

type Service struct {
	store repositoryStore
	cache repositoryCache
	objs  objectStore
}

func NewService(store repositoryStore, cache repositoryCache, objs objectStore) *Service {
	return &Service{store: store, cache: cache, objs: objs}
}

func (s *Service) CreateRepository(ctx context.Context, owner string, name string) (domain.Repository, error) {
	repo, err := s.store.CreateRepository(ctx, owner, name)
	if err != nil {
		return domain.Repository{}, err
	}
	if err := s.cache.SetRepository(ctx, repo); err != nil {
		return domain.Repository{}, err
	}
	return repo, nil
}

func (s *Service) GetRepository(ctx context.Context, owner string, name string) (domain.Repository, error) {
	repo, ok, err := s.cache.GetRepository(ctx, owner, name)
	if err != nil {
		return domain.Repository{}, err
	}
	if ok {
		return repo, nil
	}
	repo, err = s.store.GetRepository(ctx, owner, name)
	if err != nil {
		return domain.Repository{}, err
	}
	if err := s.cache.SetRepository(ctx, repo); err != nil {
		return domain.Repository{}, err
	}
	return repo, nil
}

func (s *Service) PutObject(ctx context.Context, owner string, name string, objectPath string, body io.Reader, size int64) error {
	if _, err := s.GetRepository(ctx, owner, name); err != nil {
		return err
	}
	contentType := mime.TypeByExtension(filepath.Ext(objectPath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if err := s.objs.PutObject(ctx, owner, name, objectPath, body, size, contentType); err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

func (s *Service) GetObject(ctx context.Context, owner string, name string, objectPath string) (*minio.Object, minio.ObjectInfo, error) {
	if _, err := s.GetRepository(ctx, owner, name); err != nil {
		return nil, minio.ObjectInfo{}, err
	}
	obj, info, err := s.objs.GetObject(ctx, owner, name, objectPath)
	if err != nil {
		return nil, minio.ObjectInfo{}, err
	}
	return obj, info, nil
}

func (s *Service) ListObjects(ctx context.Context, owner string, name string, prefix string) ([]domain.ObjectMeta, error) {
	if _, err := s.GetRepository(ctx, owner, name); err != nil {
		return nil, err
	}
	objects, err := s.objs.ListObjects(ctx, owner, name, prefix)
	if err != nil {
		return nil, err
	}
	return objects, nil
}

func IsNotFound(err error) bool {
	return errors.Is(err, db.ErrNotFound)
}
