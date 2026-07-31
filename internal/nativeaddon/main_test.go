package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"postcss-go/internal/csserrors"
)

func TestFitPayload(t *testing.T) {
	payload := []byte("hello-world")

	t.Run("short buffer reports needed size without write", func(t *testing.T) {
		out := make([]byte, 4)
		n := fitPayload(out, payload)
		if n != len(payload) {
			t.Fatalf("want %d, got %d", len(payload), n)
		}
		if !bytes.Equal(out, make([]byte, 4)) {
			t.Fatalf("short buffer was mutated: %q", out)
		}
	})

	t.Run("large enough buffer copies payload", func(t *testing.T) {
		out := make([]byte, len(payload)+8)
		n := fitPayload(out, payload)
		if n != len(payload) || !bytes.Equal(out[:len(payload)], payload) {
			t.Fatalf("n=%d out=%q", n, out)
		}
	})
}

func TestMainIsCallable(t *testing.T) {
	// main is intentionally empty for the c-archive entrypoint.
	main()
}

func TestNativeErrorMessageMarksOnlySyntaxErrors(t *testing.T) {
	syntaxError := csserrors.New("Unknown word", 1, 2, "a{?", "input.css", "")
	if message := nativeErrorMessage(syntaxError); !strings.HasPrefix(message, cssSyntaxErrorPrefix) {
		t.Fatalf("syntax error missing marker: %q", message)
	}

	plain := errors.New("source map could not be loaded")
	if message := nativeErrorMessage(plain); message != plain.Error() {
		t.Fatalf("plain error was changed: %q", message)
	}
}
