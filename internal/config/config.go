package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPPort        int
	MasterKey       string
	PostgresURL     string
	RedisAddr       string
	RedisPassword   string
	RedisDB         int
	S3Endpoint      string
	S3AccessKey     string
	S3SecretKey     string
	S3Bucket        string
	S3UseSSL        bool
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration
}

func Load() (Config, error) {
	port, err := intFromEnv("HTTP_PORT", 8080)
	if err != nil {
		return Config{}, err
	}
	redisDB, err := intFromEnv("REDIS_DB", 0)
	if err != nil {
		return Config{}, err
	}
	requestTimeout, err := durationFromEnv("REQUEST_TIMEOUT", 15*time.Second)
	if err != nil {
		return Config{}, err
	}
	shutdownTimeout, err := durationFromEnv("SHUTDOWN_TIMEOUT", 20*time.Second)
	if err != nil {
		return Config{}, err
	}
	return Config{
		HTTPPort:        port,
		MasterKey:       os.Getenv("MASTER_KEY"),
		PostgresURL:     os.Getenv("POSTGRES_URL"),
		RedisAddr:       strFromEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:   os.Getenv("REDIS_PASSWORD"),
		RedisDB:         redisDB,
		S3Endpoint:      os.Getenv("S3_ENDPOINT"),
		S3AccessKey:     os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:     os.Getenv("S3_SECRET_KEY"),
		S3Bucket:        os.Getenv("S3_BUCKET"),
		S3UseSSL:        boolFromEnv("S3_USE_SSL", false),
		RequestTimeout:  requestTimeout,
		ShutdownTimeout: shutdownTimeout,
	}, nil
}

func (c Config) Validate() error {
	missing := make([]string, 0)
	if c.MasterKey == "" {
		missing = append(missing, "MASTER_KEY")
	}
	if c.PostgresURL == "" {
		missing = append(missing, "POSTGRES_URL")
	}
	if c.S3Endpoint == "" {
		missing = append(missing, "S3_ENDPOINT")
	}
	if c.S3AccessKey == "" {
		missing = append(missing, "S3_ACCESS_KEY")
	}
	if c.S3SecretKey == "" {
		missing = append(missing, "S3_SECRET_KEY")
	}
	if c.S3Bucket == "" {
		missing = append(missing, "S3_BUCKET")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %v", missing)
	}
	return nil
}

func strFromEnv(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func intFromEnv(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid integer for %s: %w", key, err)
	}
	return parsed, nil
}

func boolFromEnv(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func durationFromEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("invalid duration for %s: %w", key, err)
	}
	return parsed, nil
}
