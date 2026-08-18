//go:build nativeaddon

package main

import "C"

import (
	"fmt"
	"unsafe"

	"postcss-go/internal/nativeaddon"
	"postcss-go/internal/nativebridge"
)

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
	return C.int(nativeaddon.FitPayload(out, payload))
}

func writeError(buf *C.char, capacity C.int, err error) C.int {
	if capacity <= 0 || buf == nil {
		return C.int(nativeaddon.WriteErrorBytes(nil, err))
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	return C.int(nativeaddon.WriteErrorBytes(out, err))
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
