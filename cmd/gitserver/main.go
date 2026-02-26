package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"datagen/gitserver/internal/api"
	"datagen/gitserver/internal/cache"
	"datagen/gitserver/internal/config"
	"datagen/gitserver/internal/db"
	"datagen/gitserver/internal/repository"
	"datagen/gitserver/internal/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pgStore, err := db.NewPostgresStore(rootCtx, cfg.PostgresURL)
	if err != nil {
		log.Fatalf("postgres init failed: %v", err)
	}
	defer pgStore.Close()

	redisCache, err := cache.NewRedisCache(rootCtx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("redis init failed: %v", err)
	}
	defer func() {
		_ = redisCache.Close()
	}()

	s3Store, err := storage.NewS3Store(rootCtx, cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3UseSSL)
	if err != nil {
		log.Fatalf("s3 init failed: %v", err)
	}

	repoSvc := repository.NewService(pgStore, redisCache, s3Store)
	httpServer := api.NewServer(fmt.Sprintf(":%d", cfg.HTTPPort), cfg.RequestTimeout, cfg.MasterKey, repoSvc)

	serverErrCh := make(chan error, 1)
	go func() {
		serverErrCh <- httpServer.Start()
	}()

	select {
	case <-rootCtx.Done():
	case err := <-serverErrCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server failed: %v", err)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
		os.Exit(1)
	}
	time.Sleep(50 * time.Millisecond)
}
