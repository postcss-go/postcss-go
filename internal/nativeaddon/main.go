// Package main builds the private postcss-go Node-API native library. Most
// targets use a c-archive; companion-library targets use c-shared:
//
//	go build -buildmode=c-archive -o libpostcssgo.a ./internal/nativeaddon
//	go build -buildmode=c-shared -o libpostcssgo.so ./internal/nativeaddon
//	go build -buildmode=c-shared -o libpostcssgo.dll ./internal/nativeaddon
//
// The C exports speak binary codec on the AST path so JavaScript never pays for
// JSON encode/decode on parse/stringify.
package main

// #include <stdlib.h>
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"unsafe"

	"postcss-go/internal/csserrors"
	"postcss-go/internal/nativebridge"
)

const cssSyntaxErrorPrefix = "postcss-go:css-syntax:"

func main() {}

func cBytes(ptr *C.char, length C.int) []byte {
	if length <= 0 || ptr == nil {
		return nil
	}
	return C.GoBytes(unsafe.Pointer(ptr), length)
}

func writeResult(outBuf *C.char, outCap C.int, payload []byte) C.int {
	if outCap <= 0 || outBuf == nil {
		return C.int(len(payload))
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(outBuf)), int(outCap))
	return C.int(fitPayload(out, payload))
}

func fitPayload(out []byte, payload []byte) int {
	if len(out) >= len(payload) {
		copy(out, payload)
	}
	return len(payload)
}

func writeError(buf *C.char, capacity C.int, err error) C.int {
	message := nativeErrorMessage(err)
	if capacity <= 0 || buf == nil {
		return C.int(len(message))
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	n := copy(out, message)
	return C.int(n)
}

func nativeErrorMessage(err error) string {
	var syntaxError *csserrors.SyntaxError
	if !errors.As(err, &syntaxError) {
		return err.Error()
	}
	// Omit source text so the 4KiB N-API error slot stays structured.
	payload, jsonErr := json.Marshal(struct {
		Name      string `json:"name"`
		Message   string `json:"message"`
		Reason    string `json:"reason,omitempty"`
		Line      int    `json:"line,omitempty"`
		Column    int    `json:"column,omitempty"`
		EndLine   int    `json:"endLine,omitempty"`
		EndColumn int    `json:"endColumn,omitempty"`
		File      string `json:"file,omitempty"`
		Plugin    string `json:"plugin,omitempty"`
	}{
		Name:      "CssSyntaxError",
		Message:   syntaxError.Error(),
		Reason:    syntaxError.Reason,
		Line:      syntaxError.Line,
		Column:    syntaxError.Column,
		EndLine:   syntaxError.EndLine,
		EndColumn: syntaxError.EndColumn,
		File:      syntaxError.File,
		Plugin:    syntaxError.Plugin,
	})
	if jsonErr != nil {
		return cssSyntaxErrorPrefix + syntaxError.Error()
	}
	return cssSyntaxErrorPrefix + string(payload)
}

//export pcgoCall
func pcgoCall(operation C.uchar, first *C.char, firstLen C.int, second *C.char, secondLen C.int, outBuf *C.char, outCap C.int, errBuf *C.char, errCap C.int) (result C.int) {
	defer func() {
		if recovered := recover(); recovered != nil {
			writeError(errBuf, errCap, fmt.Errorf("postcss-go native panic: %v", recovered))
			result = -1
		}
	}()
	payload, err := nativebridge.Call(
		nativebridge.Operation(operation),
		cBytes(first, firstLen),
		cBytes(second, secondLen),
	)
	if err != nil {
		writeError(errBuf, errCap, err)
		return -1
	}
	return writeResult(outBuf, outCap, payload)
}
