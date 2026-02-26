package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"datagen/gitserver/internal/domain"
	"github.com/redis/go-redis/v9"
)

type RedisCache struct {
	client *redis.Client
	ttl    time.Duration
}

func NewRedisCache(ctx context.Context, addr string, password string, db int) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &RedisCache{client: client, ttl: 5 * time.Minute}, nil
}

func (r *RedisCache) Close() error {
	return r.client.Close()
}

func (r *RedisCache) key(owner string, name string) string {
	return fmt.Sprintf("repo:%s:%s", owner, name)
}

func (r *RedisCache) SetRepository(ctx context.Context, repo domain.Repository) error {
	encoded, err := json.Marshal(repo)
	if err != nil {
		return fmt.Errorf("marshal repository: %w", err)
	}
	if err := r.client.Set(ctx, r.key(repo.Owner, repo.Name), encoded, r.ttl).Err(); err != nil {
		return fmt.Errorf("set repository cache: %w", err)
	}
	return nil
}

func (r *RedisCache) GetRepository(ctx context.Context, owner string, name string) (domain.Repository, bool, error) {
	value, err := r.client.Get(ctx, r.key(owner, name)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return domain.Repository{}, false, nil
		}
		return domain.Repository{}, false, fmt.Errorf("get repository cache: %w", err)
	}
	var repo domain.Repository
	if err := json.Unmarshal(value, &repo); err != nil {
		return domain.Repository{}, false, fmt.Errorf("unmarshal repository cache: %w", err)
	}
	return repo, true, nil
}
