package db

import (
	"context"
	"errors"
	"fmt"

	"datagen/gitserver/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, url string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	store := &PostgresStore{pool: pool}
	if err := store.ensureSchema(ctx); err != nil {
		return nil, err
	}
	return store, nil
}

func (p *PostgresStore) Close() {
	p.pool.Close()
}

func (p *PostgresStore) ensureSchema(ctx context.Context) error {
	_, err := p.pool.Exec(ctx, `
		create extension if not exists pgcrypto;
		create table if not exists repositories (
			id uuid primary key default gen_random_uuid(),
			owner text not null,
			name text not null,
			created_at timestamptz not null default now(),
			unique(owner, name)
		);
	`)
	if err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}
	return nil
}

func (p *PostgresStore) CreateRepository(ctx context.Context, owner string, name string) (domain.Repository, error) {
	row := p.pool.QueryRow(ctx, `
		insert into repositories (owner, name)
		values ($1, $2)
		returning id::text, owner, name, created_at
	`, owner, name)
	var repo domain.Repository
	if err := row.Scan(&repo.ID, &repo.Owner, &repo.Name, &repo.CreatedAt); err != nil {
		return domain.Repository{}, fmt.Errorf("create repository: %w", err)
	}
	return repo, nil
}

func (p *PostgresStore) GetRepository(ctx context.Context, owner string, name string) (domain.Repository, error) {
	row := p.pool.QueryRow(ctx, `
		select id::text, owner, name, created_at
		from repositories
		where owner = $1 and name = $2
	`, owner, name)
	var repo domain.Repository
	if err := row.Scan(&repo.ID, &repo.Owner, &repo.Name, &repo.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Repository{}, ErrNotFound
		}
		return domain.Repository{}, fmt.Errorf("get repository: %w", err)
	}
	return repo, nil
}

var ErrNotFound = errors.New("not found")
