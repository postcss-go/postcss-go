// Command native builds the postcss-go Node-API native archive:
//
//	go build -buildmode=c-archive -o libpostcssgo.a ./cmd/native
//
// The C exports speak binary codec on the AST path so JavaScript never pays for
// JSON encode/decode on parse/stringify.
package main

// #include <stdlib.h>
import "C"

import (
	"sync"
	"unsafe"
)

func main() {}

var (
	mu      sync.Mutex
	lastErr string
)

func setErr(message string) {
	mu.Lock()
	lastErr = message
	mu.Unlock()
}

func clearErr() {
	mu.Lock()
	lastErr = ""
	mu.Unlock()
}

func cBytes(ptr *C.char, length C.int) []byte {
	if length <= 0 || ptr == nil {
		return nil
	}
	return C.GoBytes(unsafe.Pointer(ptr), length)
}

func cString(ptr *C.char, length C.int) string {
	if length <= 0 || ptr == nil {
		return ""
	}
	return C.GoStringN(ptr, length)
}

func writeResult(outBuf *C.char, outCap C.int, payload []byte) C.int {
	if outCap <= 0 || outBuf == nil {
		return C.int(len(payload))
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(outBuf)), int(outCap))
	return C.int(fitPayload(out, payload))
}

//export pcgoLastError
func pcgoLastError(buf *C.char, capacity C.int) C.int {
	mu.Lock()
	message := lastErr
	mu.Unlock()
	if capacity <= 0 || buf == nil {
		return C.int(len(message))
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	n := copy(out, message)
	return C.int(n)
}

//export pcgoParse
func pcgoParse(css *C.char, cssLen C.int, from *C.char, fromLen C.int, outBuf *C.char, outCap C.int) C.int {
	clearErr()
	encoded, err := parseAST(cString(css, cssLen), cString(from, fromLen))
	if err != nil {
		setErr(err.Error())
		return -1
	}
	return writeResult(outBuf, outCap, encoded)
}

//export pcgoStringify
func pcgoStringify(ast *C.char, astLen C.int, optionsJSON *C.char, optionsLen C.int, outBuf *C.char, outCap C.int) C.int {
	clearErr()
	payload, err := stringifyAST(cBytes(ast, astLen), cBytes(optionsJSON, optionsLen))
	if err != nil {
		setErr(err.Error())
		return -1
	}
	return writeResult(outBuf, outCap, payload)
}

//export pcgoProcess
func pcgoProcess(css *C.char, cssLen C.int, optionsJSON *C.char, optionsLen C.int, outBuf *C.char, outCap C.int) C.int {
	clearErr()
	payload, err := processCSS(cString(css, cssLen), cBytes(optionsJSON, optionsLen))
	if err != nil {
		setErr(err.Error())
		return -1
	}
	return writeResult(outBuf, outCap, payload)
}

//export pcgoNoWork
func pcgoNoWork(css *C.char, cssLen C.int, optionsJSON *C.char, optionsLen C.int, outBuf *C.char, outCap C.int) C.int {
	clearErr()
	payload, err := noWorkCSS(cString(css, cssLen), cBytes(optionsJSON, optionsLen))
	if err != nil {
		setErr(err.Error())
		return -1
	}
	return writeResult(outBuf, outCap, payload)
}
