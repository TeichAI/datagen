package storage

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"

	"datagen/gitserver/internal/domain"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Store struct {
	client *minio.Client
	bucket string
}

func NewS3Store(ctx context.Context, endpoint string, accessKey string, secretKey string, bucket string, useSSL bool) (*S3Store, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("connect s3: %w", err)
	}
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("bucket exists: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
	}
	return &S3Store{client: client, bucket: bucket}, nil
}

func (s *S3Store) objectKey(owner string, repo string, objectPath string) string {
	trimmed := strings.TrimPrefix(objectPath, "/")
	return path.Join(owner, repo, trimmed)
}

func (s *S3Store) PutObject(ctx context.Context, owner string, repo string, objectPath string, body io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, s.objectKey(owner, repo, objectPath), body, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

func (s *S3Store) GetObject(ctx context.Context, owner string, repo string, objectPath string) (*minio.Object, minio.ObjectInfo, error) {
	key := s.objectKey(owner, repo, objectPath)
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("get object: %w", err)
	}
	stat, err := obj.Stat()
	if err != nil {
		return nil, minio.ObjectInfo{}, fmt.Errorf("stat object: %w", err)
	}
	return obj, stat, nil
}

func (s *S3Store) ListObjects(ctx context.Context, owner string, repo string, prefix string) ([]domain.ObjectMeta, error) {
	keyPrefix := s.objectKey(owner, repo, prefix)
	if !strings.HasSuffix(keyPrefix, "/") {
		keyPrefix += "/"
	}
	objects := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    keyPrefix,
		Recursive: true,
	})
	list := make([]domain.ObjectMeta, 0)
	for object := range objects {
		if object.Err != nil {
			return nil, fmt.Errorf("list objects: %w", object.Err)
		}
		list = append(list, domain.ObjectMeta{
			Path:         strings.TrimPrefix(object.Key, path.Join(owner, repo)+"/"),
			Size:         object.Size,
			ETag:         object.ETag,
			LastModified: object.LastModified,
		})
	}
	return list, nil
}
