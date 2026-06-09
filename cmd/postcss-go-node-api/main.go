package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/creachadair/jrpc2"
	"github.com/creachadair/jrpc2/channel"
	"postcss-go/internal/jsbridge"
)

type nopWriteCloser struct{}

func (nopWriteCloser) Write(p []byte) (int, error) {
	return os.Stdout.Write(p)
}

func (nopWriteCloser) Close() error {
	return nil
}

func main() {
	if err := run(); err != nil && !errors.Is(err, os.ErrClosed) {
		_, _ = fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run() error {
	srv := jrpc2.NewServer(jsbridge.Assigner(), nil).Start(channel.Line(os.Stdin, nopWriteCloser{}))
	return srv.Wait()
}
