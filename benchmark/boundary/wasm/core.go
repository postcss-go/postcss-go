//go:build wasip1

// Package main is built as a wasip1 reactor (`-buildmode=c-shared`) so JS can
// call exported functions synchronously without a native addon. It mirrors the
// NAPI spike's arena and entry points so the two boundaries are comparable.
package main

import "unsafe"

func main() {}

type node struct {
	prop  string
	value string
}

var (
	arena []node
	// blob holds every field back to back; index describes them as
	// (propOffset, propLength, valueOffset, valueLength) quads. Keeping both
	// alive in globals means JS can read fields straight out of linear memory.
	blob    []byte
	index   []int32
	scratch []byte
)

//go:wasmexport pcgoInitArena
func pcgoInitArena(count int32) {
	arena = make([]node, int(count))
	index = make([]int32, 0, int(count)*4)
	blob = blob[:0]
	scratch = make([]byte, 1<<20)

	for i := range arena {
		arena[i] = node{
			prop:  formatProp(i % 64),
			value: formatValue(i % 512),
		}
		for _, field := range [2]string{arena[i].prop, arena[i].value} {
			index = append(index, int32(len(blob)), int32(len(field)))
			blob = append(blob, field...)
		}
	}
}

//go:wasmexport pcgoNoop
func pcgoNoop() {}

//go:wasmexport pcgoAddInt
func pcgoAddInt(a int32, b int32) int32 {
	return a + b
}

// pcgoGetProp copies into a scratch buffer, matching the NAPI shim's approach.
//
//go:wasmexport pcgoGetProp
func pcgoGetProp(handle int32) int32 {
	i := int(handle)
	if i < 0 || i >= len(arena) {
		return -1
	}
	return int32(copy(scratch, arena[i].prop))
}

//go:wasmexport pcgoSetValue
func pcgoSetValue(handle int32, length int32) int32 {
	i := int(handle)
	if i < 0 || i >= len(arena) {
		return -1
	}
	arena[i].value = string(scratch[:length])
	return 0
}

// pcgoScratchPtr, pcgoBlobPtr, and pcgoIndexPtr hand JS stable offsets into
// linear memory so field reads need no crossing at all.
//
//go:wasmexport pcgoScratchPtr
func pcgoScratchPtr() int32 {
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(scratch))))
}

//go:wasmexport pcgoBlobPtr
func pcgoBlobPtr() int32 {
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(blob))))
}

//go:wasmexport pcgoIndexPtr
func pcgoIndexPtr() int32 {
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(index))))
}

func formatProp(n int) string {
	return "margin-" + itoa(n)
}

func formatValue(n int) string {
	return itoa(n) + "px solid rgba(0, 0, 0, 0.5)"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
