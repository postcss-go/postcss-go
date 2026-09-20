//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"syscall/js"

	"github.com/postcss-go/postcss-go/internal/asthandle"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

var errBridgeDrift = errors.New("wasm handle exports do not match the generated bridge methods")

// handleSessions owns every browser main-thread AST arena. The AST never leaves
// this runtime: JavaScript only ever sees session-scoped numeric handles.
var handleSessions asthandle.Registry

// Results cross the boundary as envelopes rather than thrown values, because a
// Go panic inside js.FuncOf tears down the whole instance instead of raising a
// catchable JavaScript exception. The TypeScript bridge rethrows with status.
func handleOK(value any) any {
	return map[string]any{"ok": true, "value": value}
}

func handleErr(err error) any {
	return map[string]any{
		"ok":      false,
		"status":  asthandle.ErrorStatus(err),
		"message": err.Error(),
	}
}

func withSession(args []js.Value, fn func(*asthandle.Session) any) any {
	if len(args) == 0 {
		return handleErr(asthandle.ErrInvalidArgument)
	}
	session, release := handleSessions.Acquire(uint32(args[0].Int()))
	defer release()
	if session == nil {
		return handleErr(asthandle.ErrClosed)
	}
	return fn(session)
}

func handleList(value js.Value) []asthandle.Handle {
	length := value.Length()
	handles := make([]asthandle.Handle, length)
	for i := 0; i < length; i++ {
		handles[i] = asthandle.Handle(value.Index(i).Int())
	}
	return handles
}

func stringList(value js.Value) []string {
	length := value.Length()
	values := make([]string, length)
	for i := 0; i < length; i++ {
		values[i] = value.Index(i).String()
	}
	return values
}

// writeHandles fills a caller-owned Uint32Array without copying through Go.
func writeHandles(dst js.Value, handles []asthandle.Handle) int {
	n := len(handles)
	if n > dst.Length() {
		n = dst.Length()
	}
	for i := 0; i < n; i++ {
		dst.SetIndex(i, uint32(handles[i]))
	}
	return n
}

func handleExports() map[string]func([]js.Value) any {
	return map[string]func([]js.Value) any{
		"handleProtocolInfo": func([]js.Value) any {
			capabilities := js.Global().Get("Uint32Array").New(1)
			capabilities.SetIndex(0, asthandle.Capabilities)
			return handleOK(map[string]any{
				"major":        asthandle.ProtocolMajor,
				"minor":        asthandle.ProtocolMinor,
				"maxBatchSize": asthandle.MaxBatchSize,
				"capabilities": capabilities,
				"sessions":     handleSessions.Len(),
			})
		},
		"handleParse": func(args []js.Value) any {
			if len(args) == 0 {
				return handleErr(asthandle.ErrInvalidArgument)
			}
			var options sourcemap.Options
			if len(args) > 1 && args[1].Type() == js.TypeString {
				var decoded struct {
					From         string `json:"from"`
					Document     string `json:"document"`
					TrackSource  bool   `json:"trackSource"`
					SourceMap    string `json:"sourceMap"`
					SourceMapURL string `json:"sourceMapUrl"`
				}
				if err := json.Unmarshal([]byte(args[1].String()), &decoded); err != nil {
					return handleErr(asthandle.ErrInvalidArgument)
				}
				options = sourcemap.Options{
					From:         decoded.From,
					Document:     decoded.Document,
					TrackSource:  decoded.TrackSource,
					SourceMapURL: decoded.SourceMapURL,
				}
				if decoded.SourceMap != "" {
					options.SourceMap = []byte(decoded.SourceMap)
				}
			}
			id, root, err := handleSessions.ParseWithOptions(args[0].String(), options)
			if err != nil {
				return handleErr(err)
			}
			return handleOK(map[string]any{"sessionId": id, "rootId": uint32(root)})
		},
		"handleClose": func(args []js.Value) any {
			if len(args) == 0 {
				return handleErr(asthandle.ErrInvalidArgument)
			}
			handleSessions.Close(uint32(args[0].Int()))
			return handleOK(nil)
		},
		"handleType": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				kind, err := session.Type(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(kind)
			})
		},
		"handleGetField": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				value, err := session.GetField(asthandle.Handle(args[1].Int()), asthandle.Field(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(value)
			})
		},
		"handleSetField": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.SetField(asthandle.Handle(args[1].Int()), asthandle.Field(args[2].Int()), args[3].String())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleWalkDecls": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handles, err := session.Collect(asthandle.Handle(args[1].Int()), true)
				if err != nil {
					return handleErr(err)
				}
				writeHandles(args[2], handles)
				return handleOK(len(handles))
			})
		},
		"handleOpenCursor": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				declsOnly := len(args) > 2 && args[2].Truthy()
				id, err := session.OpenCursor(asthandle.Handle(args[1].Int()), declsOnly)
				if err != nil {
					return handleErr(err)
				}
				return handleOK(id)
			})
		},
		"handleCursorNext": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				buffer := make([]asthandle.Handle, args[2].Length())
				n, err := session.CursorNext(uint32(args[1].Int()), buffer)
				if err != nil {
					return handleErr(err)
				}
				return handleOK(writeHandles(args[2], buffer[:n]))
			})
		},
		"handleCloseCursor": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				if err := session.CloseCursor(uint32(args[1].Int())); err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleReadFields": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				values, err := session.ReadFields(handleList(args[1]), asthandle.Field(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				out := make([]any, len(values))
				for i, value := range values {
					out[i] = value
				}
				return handleOK(out)
			})
		},
		"handleSetFields": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.SetFields(handleList(args[1]), asthandle.Field(args[2].Int()), stringList(args[3]))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleStringify": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				css, err := session.Stringify(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(css)
			})
		},
		"handleNewDecl": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handle, err := session.NewDecl(args[1].String(), args[2].String())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(handle))
			})
		},
		"handleAppend": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.Append(asthandle.Handle(args[1].Int()), asthandle.Handle(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleDispose": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				if err := session.Dispose(asthandle.Handle(args[1].Int())); err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleReadSnapshots": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handles := handleList(args[1])
				if uint32(len(handles)) > asthandle.MaxBatchSize {
					return handleErr(asthandle.ErrInvalidArgument)
				}
				rows, err := session.ReadSnapshots(handles)
				if err != nil {
					return handleErr(err)
				}
				encoded, err := json.Marshal(rows)
				if err != nil {
					return handleErr(err)
				}
				return handleOK(string(encoded))
			})
		},
		"handleApplyPatches": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handles := handleList(args[1])
				values := stringList(args[3])
				if args[2].Length() != len(handles) || len(values) != len(handles) {
					return handleErr(asthandle.ErrInvalidArgument)
				}
				patches := make([]asthandle.FieldPatch, len(handles))
				for i, handle := range handles {
					patches[i] = asthandle.FieldPatch{
						Handle: handle,
						Field:  asthandle.Field(args[2].Index(i).Int()),
						Value:  values[i],
					}
				}
				if err := session.ApplyPatches(patches); err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleInsertBefore": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.InsertBefore(asthandle.Handle(args[1].Int()), asthandle.Handle(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleRemove": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				if err := session.Remove(asthandle.Handle(args[1].Int())); err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleClone": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handle, err := session.Clone(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(handle))
			})
		},
		"handlePrepend": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.Prepend(asthandle.Handle(args[1].Int()), asthandle.Handle(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleInsertAfter": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.InsertAfter(asthandle.Handle(args[1].Int()), asthandle.Handle(args[2].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleReplaceWith": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				err := session.ReplaceWith(asthandle.Handle(args[1].Int()), handleList(args[2])...)
				if err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleNewRule": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handle, err := session.NewRule(args[1].String())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(handle))
			})
		},
		"handleNewAtRule": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handle, err := session.NewAtRule(args[1].String(), args[2].String())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(handle))
			})
		},
		"handleNewComment": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				handle, err := session.NewComment(args[1].String())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(handle))
			})
		},
		"handleSetRaw": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				var patch asthandle.RawPatch
				if err := json.Unmarshal([]byte(args[2].String()), &patch); err != nil {
					return handleErr(asthandle.ErrInvalidArgument)
				}
				if err := session.SetRaw(asthandle.Handle(args[1].Int()), patch); err != nil {
					return handleErr(err)
				}
				return handleOK(nil)
			})
		},
		"handleGetRaws": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				value, err := session.GetRawsJSON(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(value)
			})
		},
		"handleStringifyMap": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				var opts struct {
					From               string `json:"from"`
					To                 string `json:"to"`
					MapFile            string `json:"mapFile"`
					Absolute           bool   `json:"absolute"`
					PreserveAnnotation bool   `json:"preserveAnnotation"`
				}
				if len(args) > 2 && args[2].Type() == js.TypeString {
					if err := json.Unmarshal([]byte(args[2].String()), &opts); err != nil {
						return handleErr(asthandle.ErrInvalidArgument)
					}
				}
				css, mapJSON, err := session.StringifyMap(asthandle.Handle(args[1].Int()), stringifier.SourceMapOptions{
					From:               opts.From,
					To:                 opts.To,
					MapFile:            opts.MapFile,
					Absolute:           opts.Absolute,
					PreserveAnnotation: opts.PreserveAnnotation,
				})
				if err != nil {
					return handleErr(err)
				}
				encoded, err := json.Marshal(map[string]string{"css": css, "map": mapJSON})
				if err != nil {
					return handleErr(err)
				}
				return handleOK(string(encoded))
			})
		},
		"handleParent": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				parent, err := session.Parent(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(parent))
			})
		},
		"handleChildCount": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				count, err := session.ChildCount(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(count)
			})
		},
		"handleChildAt": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				child, err := session.ChildAt(asthandle.Handle(args[1].Int()), args[2].Int())
				if err != nil {
					return handleErr(err)
				}
				return handleOK(uint32(child))
			})
		},
		"handleStringifyBuilder": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				encoded, err := session.StringifyBuilder(asthandle.Handle(args[1].Int()))
				if err != nil {
					return handleErr(err)
				}
				return handleOK(encoded)
			})
		},
		"handleQuery": func(args []js.Value) any {
			return withSession(args, func(session *asthandle.Session) any {
				kind := ""
				if len(args) > 2 {
					kind = args[2].String()
				}
				options := ""
				if len(args) > 3 && args[3].Type() == js.TypeString {
					options = args[3].String()
				}
				encoded, err := session.Query(asthandle.Handle(args[1].Int()), kind, options)
				if err != nil {
					return handleErr(err)
				}
				return handleOK(encoded)
			})
		},
	}
}

// registerHandleExports publishes the generated bridge surface. A missing or
// extra export fails startup so the WASM transport cannot silently drift from
// the schema the Node addon and TypeScript facade are generated from.
func registerHandleExports() ([]js.Func, error) {
	exports := handleExports()
	if len(exports) != len(asthandle.BridgeMethods) {
		return nil, errBridgeDrift
	}
	table := js.Global().Get("Object").New()
	retained := make([]js.Func, 0, len(exports))
	for _, name := range asthandle.BridgeMethods {
		implementation, found := exports[name]
		if !found {
			return nil, errBridgeDrift
		}
		fn := js.FuncOf(func(_ js.Value, args []js.Value) any { return implementation(args) })
		retained = append(retained, fn)
		table.Set(name, fn)
	}
	js.Global().Set("postcssGoHandles", table)
	return retained, nil
}
