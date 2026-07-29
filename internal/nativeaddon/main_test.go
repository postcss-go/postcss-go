package main

import (
	"bytes"
	"testing"
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
