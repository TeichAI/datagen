package domain

import "time"

type Repository struct {
	ID        string    `json:"id"`
	Owner     string    `json:"owner"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type ObjectMeta struct {
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	ETag         string    `json:"etag"`
	LastModified time.Time `json:"last_modified"`
}
