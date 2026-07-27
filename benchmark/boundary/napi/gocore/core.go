// Package main is built as a c-archive and linked into the spike Node addon.
// It stands in for a future internal/nativeapi package: a handle table over
// AST-shaped nodes plus the flat C entry points a NAPI shim would call.
package main

import "C"

import (
	"fmt"
	"unsafe"
)

func main() {}

// node mirrors the fields a Declaration handle would expose across the border.
type node struct {
	prop  string
	value string
}

var arena []node

//export pcgoInitArena
func pcgoInitArena(count C.int) {
	arena = make([]node, int(count))
	for i := range arena {
		arena[i] = node{
			prop:  fmt.Sprintf("margin-%d", i%64),
			value: fmt.Sprintf("%dpx solid rgba(0, 0, 0, 0.5)", i%512),
		}
	}
}

// pcgoNoop measures the floor: NAPI dispatch plus one cgo transition.
//
//export pcgoNoop
func pcgoNoop() {}

// pcgoAddInt measures a scalar round trip with arguments and a return value.
//
//export pcgoAddInt
func pcgoAddInt(a C.int, b C.int) C.int {
	return a + b
}

// pcgoGetProp copies a handle's property into a caller-owned buffer, which is
// the only way a Go string can legally reach C memory. Returns the byte count.
//
//export pcgoGetProp
func pcgoGetProp(handle C.int, buf *C.char, capacity C.int) C.int {
	i := int(handle)
	if i < 0 || i >= len(arena) {
		return -1
	}
	return C.int(copyOut(arena[i].prop, buf, capacity))
}

// pcgoSetValue writes a JS-provided string back into the Go-owned node.
//
//export pcgoSetValue
func pcgoSetValue(handle C.int, buf *C.char, length C.int) C.int {
	i := int(handle)
	if i < 0 || i >= len(arena) {
		return -1
	}
	arena[i].value = C.GoStringN(buf, length)
	return 0
}

// pcgoGetPropsBatch copies `count` properties as length-prefixed records in a
// single crossing, so batching can be compared against per-property calls.
//
//export pcgoGetPropsBatch
func pcgoGetPropsBatch(start C.int, count C.int, buf *C.char, capacity C.int) C.int {
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	offset := 0
	for i := 0; i < int(count); i++ {
		index := int(start) + i
		if index >= len(arena) {
			break
		}
		for _, field := range [2]string{arena[index].prop, arena[index].value} {
			if offset+4+len(field) > len(out) {
				return -1
			}
			out[offset] = byte(len(field))
			out[offset+1] = byte(len(field) >> 8)
			out[offset+2] = byte(len(field) >> 16)
			out[offset+3] = byte(len(field) >> 24)
			offset += 4
			offset += copy(out[offset:], field)
		}
	}
	return C.int(offset)
}

func copyOut(value string, buf *C.char, capacity C.int) int {
	if len(value) > int(capacity) {
		return -1
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	return copy(out, value)
}
