package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"gongming/server/internal/platform"
)

func main() {
	if err := run(); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	environment := platform.Env("APP_ENV", "production")
	origins := platform.Env("ALLOWED_ORIGINS", "")
	if environment == "development" && origins == "" {
		origins = "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174"
	}
	cfg := platform.Config{Environment: environment, CookieSecure: platform.Env("COOKIE_SECURE", "true") == "true", BcryptCost: 12}
	cfg.MediaDirectory = os.Getenv("MEDIA_DIRECTORY")
	if cfg.MediaDirectory == "" && environment == "development" {
		var err error
		cfg.MediaDirectory, err = filepath.Abs("../.runtime/media")
		if err != nil {
			return err
		}
	}
	if environment == "development" && os.Getenv("COOKIE_SECURE") == "" {
		cfg.CookieSecure = false
	}
	for _, origin := range strings.Split(origins, ",") {
		if strings.TrimSpace(origin) != "" {
			cfg.Origins = append(cfg.Origins, strings.TrimSpace(origin))
		}
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	if err := platform.PrepareMediaDirectory(cfg.MediaDirectory); err != nil {
		return err
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" && environment == "development" {
		dsn = "postgres://gongming:gongming_dev@127.0.0.1:55432/gongming?sslmode=disable"
	}
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	store, err := platform.OpenPostgres(startup, dsn)
	if err != nil {
		return err
	}
	defer store.Close()
	if err = store.Migrate(startup); err != nil {
		return err
	}
	app := platform.NewApp(store, cfg)
	defer app.CloseStreams()
	if err = app.CheckProductionData(startup); err != nil {
		return err
	}
	if environment == "development" {
		if err = app.SeedDevelopment(startup); err != nil {
			return err
		}
	} else {
		if err = app.BootstrapAdmin(startup, os.Getenv("BOOTSTRAP_ADMIN_EMAIL"), os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"), os.Getenv("BOOTSTRAP_ADMIN_HANDLE")); err != nil {
			return err
		}
	}
	server := &http.Server{Addr: platform.Env("API_ADDR", "127.0.0.1:8080"), Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	server.RegisterOnShutdown(app.CloseStreams)
	errCh := make(chan error, 1)
	go func() {
		slog.Info("API ready", "address", server.Addr, "environment", environment, "storage", "postgresql")
		errCh <- server.ListenAndServe()
	}()
	select {
	case <-ctx.Done():
		shutdown, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		return server.Shutdown(shutdown)
	case err = <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
