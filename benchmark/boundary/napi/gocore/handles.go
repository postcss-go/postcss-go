//go:build boundary_napi

package main

import "C"

import (
	"unsafe"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

var (
	handleSession *asthandle.Session
	handleErr     error
)

func handleFail() C.int {
	return -1
}

func lookupSession() *asthandle.Session {
	if handleSession == nil {
		handleErr = asthandle.ErrClosed
		return nil
	}
	return handleSession
}

//export pcgoHandleParse
func pcgoHandleParse(buf *C.char, length C.int) C.uint {
	css := C.GoStringN(buf, length)
	session, root, err := asthandle.Parse(css)
	if err != nil {
		handleErr = err
		return 0
	}
	if handleSession != nil {
		handleSession.Close()
	}
	handleSession = session
	handleErr = nil
	return C.uint(root)
}

//export pcgoHandleClose
func pcgoHandleClose() {
	if handleSession != nil {
		handleSession.Close()
		handleSession = nil
	}
}

//export pcgoHandleType
func pcgoHandleType(handle C.uint) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	kind, err := session.Type(asthandle.Handle(handle))
	if err != nil {
		handleErr = err
		return handleFail()
	}
	return C.int(kind)
}

//export pcgoHandleGetField
func pcgoHandleGetField(handle C.uint, field C.int, buf *C.char, capacity C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	value, err := session.GetField(asthandle.Handle(handle), asthandle.Field(field))
	if err != nil {
		handleErr = err
		return handleFail()
	}
	return C.int(copyOut(value, buf, capacity))
}

//export pcgoHandleSetField
func pcgoHandleSetField(handle C.uint, field C.int, buf *C.char, length C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	if err := session.SetField(asthandle.Handle(handle), asthandle.Field(field), C.GoStringN(buf, length)); err != nil {
		handleErr = err
		return handleFail()
	}
	return 0
}

//export pcgoHandleWalkDecls
func pcgoHandleWalkDecls(root C.uint, out *C.uint, capacity C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	handles, err := session.Collect(asthandle.Handle(root), true)
	if err != nil {
		handleErr = err
		return handleFail()
	}
	n := len(handles)
	if n > int(capacity) {
		n = int(capacity)
	}
	dst := unsafe.Slice((*uint32)(unsafe.Pointer(out)), int(capacity))
	for i := 0; i < n; i++ {
		dst[i] = uint32(handles[i])
	}
	return C.int(len(handles))
}

//export pcgoHandleOpenCursor
func pcgoHandleOpenCursor(root C.uint, declsOnly C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	id, err := session.OpenCursor(asthandle.Handle(root), declsOnly != 0)
	if err != nil {
		handleErr = err
		return handleFail()
	}
	return C.int(id)
}

//export pcgoHandleCursorNext
func pcgoHandleCursorNext(id C.int, out *C.uint, capacity C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	buf := make([]asthandle.Handle, int(capacity))
	n, err := session.CursorNext(int(id), buf)
	if err != nil {
		handleErr = err
		return handleFail()
	}
	dst := unsafe.Slice((*uint32)(unsafe.Pointer(out)), int(capacity))
	for i := 0; i < n; i++ {
		dst[i] = uint32(buf[i])
	}
	return C.int(n)
}

//export pcgoHandleCloseCursor
func pcgoHandleCloseCursor(id C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	if err := session.CloseCursor(int(id)); err != nil {
		handleErr = err
		return handleFail()
	}
	return 0
}

//export pcgoHandleReadFields
func pcgoHandleReadFields(handles *C.uint, count C.int, field C.int, buf *C.char, capacity C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	values, err := session.ReadFields(list, asthandle.Field(field))
	if err != nil {
		handleErr = err
		return handleFail()
	}
	out := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(capacity))
	offset := 0
	for _, value := range values {
		if offset+4+len(value) > len(out) {
			handleErr = asthandle.ErrInvalidHandle
			return handleFail()
		}
		out[offset] = byte(len(value))
		out[offset+1] = byte(len(value) >> 8)
		out[offset+2] = byte(len(value) >> 16)
		out[offset+3] = byte(len(value) >> 24)
		offset += 4
		offset += copy(out[offset:], value)
	}
	return C.int(offset)
}

//export pcgoHandleSetFields
func pcgoHandleSetFields(handles *C.uint, count C.int, field C.int, buf *C.char, length C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	ids := unsafe.Slice((*uint32)(unsafe.Pointer(handles)), int(count))
	list := make([]asthandle.Handle, len(ids))
	for i, id := range ids {
		list[i] = asthandle.Handle(id)
	}
	payload := unsafe.Slice((*byte)(unsafe.Pointer(buf)), int(length))
	values := make([]string, 0, len(list))
	offset := 0
	for offset < len(payload) {
		if offset+4 > len(payload) {
			break
		}
		n := int(payload[offset]) | int(payload[offset+1])<<8 | int(payload[offset+2])<<16 | int(payload[offset+3])<<24
		offset += 4
		if offset+n > len(payload) {
			handleErr = asthandle.ErrInvalidHandle
			return handleFail()
		}
		values = append(values, string(payload[offset:offset+n]))
		offset += n
	}
	if err := session.SetFields(list, asthandle.Field(field), values); err != nil {
		handleErr = err
		return handleFail()
	}
	return 0
}

//export pcgoHandleNewDecl
func pcgoHandleNewDecl(prop *C.char, propLen C.int, value *C.char, valueLen C.int) C.uint {
	session := lookupSession()
	if session == nil {
		return 0
	}
	handle, err := session.NewDecl(C.GoStringN(prop, propLen), C.GoStringN(value, valueLen))
	if err != nil {
		handleErr = err
		return 0
	}
	return C.uint(handle)
}

//export pcgoHandleAppend
func pcgoHandleAppend(parent C.uint, child C.uint) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	if err := session.Append(asthandle.Handle(parent), asthandle.Handle(child)); err != nil {
		handleErr = err
		return handleFail()
	}
	return 0
}

//export pcgoHandleDispose
func pcgoHandleDispose(handle C.uint) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	if err := session.Dispose(asthandle.Handle(handle)); err != nil {
		handleErr = err
		return handleFail()
	}
	return 0
}

//export pcgoHandleStringify
func pcgoHandleStringify(handle C.uint, buf *C.char, capacity C.int) C.int {
	session := lookupSession()
	if session == nil {
		return handleFail()
	}
	css, err := session.Stringify(asthandle.Handle(handle))
	if err != nil {
		handleErr = err
		return handleFail()
	}
	return C.int(copyOut(css, buf, capacity))
}
