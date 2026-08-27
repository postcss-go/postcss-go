//go:build wasip1

package main

import (
	"unsafe"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

var (
	handleSession *asthandle.Session
	handleScratch []byte
	handleOut     []uint32
)

func ensureHandleScratch(size int) int32 {
	if cap(handleScratch) < size {
		handleScratch = make([]byte, size)
	} else {
		handleScratch = handleScratch[:size]
	}
	if len(handleScratch) == 0 {
		return 0
	}
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(handleScratch))))
}

//go:wasmexport pcgoHandleEnsureScratch
func pcgoHandleEnsureScratch(size int32) int32 {
	return ensureHandleScratch(int(size))
}

//go:wasmexport pcgoHandleScratchPtr
func pcgoHandleScratchPtr() int32 {
	if len(handleScratch) == 0 {
		return 0
	}
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(handleScratch))))
}

//go:wasmexport pcgoHandleParse
func pcgoHandleParse(length int32) int32 {
	css := string(handleScratch[:length])
	session, root, err := asthandle.Parse(css)
	if err != nil {
		return 0
	}
	if handleSession != nil {
		handleSession.Close()
	}
	handleSession = session
	return int32(root)
}

//go:wasmexport pcgoHandleClose
func pcgoHandleClose() {
	if handleSession != nil {
		handleSession.Close()
		handleSession = nil
	}
}

//go:wasmexport pcgoHandleGetField
func pcgoHandleGetField(handle int32, field int32) int32 {
	if handleSession == nil {
		return -1
	}
	value, err := handleSession.GetField(asthandle.Handle(handle), asthandle.Field(field))
	if err != nil {
		return -1
	}
	ensureHandleScratch(len(value))
	return int32(copy(handleScratch, value))
}

//go:wasmexport pcgoHandleSetField
func pcgoHandleSetField(handle int32, field int32, length int32) int32 {
	if handleSession == nil {
		return -1
	}
	if err := handleSession.SetField(asthandle.Handle(handle), asthandle.Field(field), string(handleScratch[:length])); err != nil {
		return -1
	}
	return 0
}

//go:wasmexport pcgoHandleWalkDecls
func pcgoHandleWalkDecls(root int32) int32 {
	if handleSession == nil {
		return -1
	}
	handles, err := handleSession.Collect(asthandle.Handle(root), true)
	if err != nil {
		return -1
	}
	if cap(handleOut) < len(handles) {
		handleOut = make([]uint32, len(handles))
	} else {
		handleOut = handleOut[:len(handles)]
	}
	for i, h := range handles {
		handleOut[i] = uint32(h)
	}
	return int32(len(handles))
}

//go:wasmexport pcgoHandleOutPtr
func pcgoHandleOutPtr() int32 {
	if len(handleOut) == 0 {
		return 0
	}
	return int32(uintptr(unsafe.Pointer(unsafe.SliceData(handleOut))))
}

//go:wasmexport pcgoHandleEnsureOut
func pcgoHandleEnsureOut(count int32) int32 {
	if cap(handleOut) < int(count) {
		handleOut = make([]uint32, int(count))
	} else {
		handleOut = handleOut[:int(count)]
	}
	return pcgoHandleOutPtr()
}

//go:wasmexport pcgoHandleReadFields
func pcgoHandleReadFields(count int32, field int32) int32 {
	if handleSession == nil {
		return -1
	}
	list := make([]asthandle.Handle, int(count))
	for i := 0; i < int(count); i++ {
		list[i] = asthandle.Handle(handleOut[i])
	}
	values, err := handleSession.ReadFields(list, asthandle.Field(field))
	if err != nil {
		return -1
	}
	needed := 0
	for _, value := range values {
		needed += 4 + len(value)
	}
	ensureHandleScratch(needed)
	offset := 0
	for _, value := range values {
		handleScratch[offset] = byte(len(value))
		handleScratch[offset+1] = byte(len(value) >> 8)
		handleScratch[offset+2] = byte(len(value) >> 16)
		handleScratch[offset+3] = byte(len(value) >> 24)
		offset += 4
		offset += copy(handleScratch[offset:], value)
	}
	return int32(offset)
}

//go:wasmexport pcgoHandleSetFields
func pcgoHandleSetFields(count int32, field int32, length int32) int32 {
	if handleSession == nil {
		return -1
	}
	list := make([]asthandle.Handle, int(count))
	for i := 0; i < int(count); i++ {
		list[i] = asthandle.Handle(handleOut[i])
	}
	payload := handleScratch[:length]
	values := make([]string, 0, int(count))
	offset := 0
	for offset < len(payload) {
		n := int(payload[offset]) | int(payload[offset+1])<<8 | int(payload[offset+2])<<16 | int(payload[offset+3])<<24
		offset += 4
		values = append(values, string(payload[offset:offset+n]))
		offset += n
	}
	if err := handleSession.SetFields(list, asthandle.Field(field), values); err != nil {
		return -1
	}
	return 0
}

//go:wasmexport pcgoHandleOpenCursor
func pcgoHandleOpenCursor(root int32, declsOnly int32) int32 {
	if handleSession == nil {
		return -1
	}
	id, err := handleSession.OpenCursor(asthandle.Handle(root), declsOnly != 0)
	if err != nil {
		return -1
	}
	return int32(id)
}

//go:wasmexport pcgoHandleCursorNext
func pcgoHandleCursorNext(id int32, capacity int32) int32 {
	if handleSession == nil {
		return -1
	}
	if cap(handleOut) < int(capacity) {
		handleOut = make([]uint32, int(capacity))
	} else {
		handleOut = handleOut[:int(capacity)]
	}
	buf := make([]asthandle.Handle, int(capacity))
	n, err := handleSession.CursorNext(int(id), buf)
	if err != nil {
		return -1
	}
	handleOut = handleOut[:n]
	for i := 0; i < n; i++ {
		handleOut[i] = uint32(buf[i])
	}
	return int32(n)
}

//go:wasmexport pcgoHandleCloseCursor
func pcgoHandleCloseCursor(id int32) int32 {
	if handleSession == nil {
		return -1
	}
	if err := handleSession.CloseCursor(int(id)); err != nil {
		return -1
	}
	return 0
}

//go:wasmexport pcgoHandleStringify
func pcgoHandleStringify(handle int32) int32 {
	if handleSession == nil {
		return -1
	}
	css, err := handleSession.Stringify(asthandle.Handle(handle))
	if err != nil {
		return -1
	}
	ensureHandleScratch(len(css))
	return int32(copy(handleScratch, css))
}
