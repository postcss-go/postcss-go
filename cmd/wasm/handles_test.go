//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"testing"

	"github.com/postcss-go/postcss-go/internal/asthandle"
)

func value(t *testing.T, envelope any) any {
	t.Helper()
	row, ok := envelope.(map[string]any)
	if !ok {
		t.Fatalf("envelope is not an object: %#v", envelope)
	}
	if row["ok"] != true {
		t.Fatalf("handle call failed: status=%v message=%v", row["status"], row["message"])
	}
	return row["value"]
}

func failure(t *testing.T, envelope any) (uint32, string) {
	t.Helper()
	row, ok := envelope.(map[string]any)
	if !ok {
		t.Fatalf("envelope is not an object: %#v", envelope)
	}
	if row["ok"] != false {
		t.Fatalf("expected failure, got %#v", row)
	}
	return row["status"].(uint32), row["message"].(string)
}

func jsNumber(v any) js.Value { return js.ValueOf(v) }

func TestHandleExportsMatchGeneratedBridgeMethods(t *testing.T) {
	exports := handleExports()
	if len(exports) != len(asthandle.BridgeMethods) {
		t.Fatalf("export count %d does not match %d generated bridge methods", len(exports), len(asthandle.BridgeMethods))
	}
	for _, name := range asthandle.BridgeMethods {
		if _, found := exports[name]; !found {
			t.Errorf("missing WASM export for generated bridge method %q", name)
		}
	}
}

func TestHandleProtocolInfoAdvertisesGeneratedContract(t *testing.T) {
	info := value(t, handleExports()["handleProtocolInfo"](nil)).(map[string]any)
	if info["major"] != asthandle.ProtocolMajor || info["minor"] != asthandle.ProtocolMinor {
		t.Fatalf("unexpected protocol version %v.%v", info["major"], info["minor"])
	}
	if info["maxBatchSize"] != asthandle.MaxBatchSize {
		t.Fatalf("unexpected max batch size %v", info["maxBatchSize"])
	}
	capabilities := info["capabilities"].(js.Value)
	if uint32(capabilities.Index(0).Int()) != asthandle.Capabilities {
		t.Fatalf("unexpected capability mask %v", capabilities.Index(0).Int())
	}
}

func TestHandleSessionRoundTripKeepsAstInGo(t *testing.T) {
	exports := handleExports()
	created := value(t, exports["handleParse"]([]js.Value{jsNumber("a{color:red}")})).(map[string]any)
	session := jsNumber(created["sessionId"])
	root := jsNumber(created["rootId"])
	defer exports["handleClose"]([]js.Value{session})

	buffer := js.Global().Get("Uint32Array").New(8)
	count := value(t, exports["handleWalkDecls"]([]js.Value{session, root, buffer})).(int)
	if count != 1 {
		t.Fatalf("expected one declaration, got %d", count)
	}
	decl := jsNumber(buffer.Index(0).Int())

	prop := value(t, exports["handleGetField"]([]js.Value{session, decl, jsNumber(int(asthandle.FieldProp))}))
	if prop != "color" {
		t.Fatalf("unexpected prop %q", prop)
	}

	value(t, exports["handleSetField"]([]js.Value{session, decl, jsNumber(int(asthandle.FieldValue)), jsNumber("blue")}))
	css := value(t, exports["handleStringify"]([]js.Value{session, root}))
	if css != "a{color:blue}" {
		t.Fatalf("unexpected css %q", css)
	}

	snapshots := value(t, exports["handleReadSnapshots"]([]js.Value{session, buffer.Call("subarray", 0, 1)}))
	var rows []map[string]any
	if err := json.Unmarshal([]byte(snapshots.(string)), &rows); err != nil {
		t.Fatalf("snapshot JSON: %v", err)
	}
	if len(rows) != 1 || rows[0]["value"] != "blue" {
		t.Fatalf("unexpected snapshot rows %#v", rows)
	}
}

func TestHandleFailuresCarryStatusInsteadOfPanicking(t *testing.T) {
	exports := handleExports()
	status, message := failure(t, exports["handleType"]([]js.Value{jsNumber(0), jsNumber(1)}))
	if status != asthandle.StatusClosed || message == "" {
		t.Fatalf("unexpected closed-session failure: status=%d message=%q", status, message)
	}

	created := value(t, exports["handleParse"]([]js.Value{jsNumber("a{}")})).(map[string]any)
	session := jsNumber(created["sessionId"])
	defer exports["handleClose"]([]js.Value{session})
	status, _ = failure(t, exports["handleType"]([]js.Value{session, jsNumber(0xffff)}))
	if status != asthandle.StatusInvalidHandle {
		t.Fatalf("unexpected invalid-handle status %d", status)
	}

	status, _ = failure(t, exports["handleParse"]([]js.Value{jsNumber("a{}"), jsNumber("{oops")}))
	if status != asthandle.StatusInvalidArgument {
		t.Fatalf("unexpected malformed-options status %d", status)
	}
}
