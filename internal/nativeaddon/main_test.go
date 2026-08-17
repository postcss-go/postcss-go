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
	message := nativeErrorMessage(syntaxError)
	if !strings.HasPrefix(message, cssSyntaxErrorPrefix) {
		t.Fatalf("syntax error missing marker: %q", message)
	}
	payload := strings.TrimPrefix(message, cssSyntaxErrorPrefix)
	if !strings.Contains(payload, `"name":"CssSyntaxError"`) || !strings.Contains(payload, `"reason":"Unknown word"`) {
		t.Fatalf("syntax error missing JSON DTO: %q", message)
	}
	if strings.Contains(payload, "a{?") {
		t.Fatalf("syntax error leaked source into the N-API slot: %q", message)
	}

	plain := errors.New("source map could not be loaded")
	if got := nativeErrorMessage(plain); got != plain.Error() {
		t.Fatalf("plain error was changed: %q", got)
	}
}

func TestWriteErrorReportsRequiredCapacity(t *testing.T) {
	err := errors.New("source map could not be loaded")
	want := len(err.Error())

	if got := int(writeError(nil, 0, err)); got != want {
		t.Fatalf("want required capacity %d, got %d", want, got)
	}
}
