//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/postcss-go/postcss-go/internal/jsbridge"
)

func main() {
	request := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) == 0 {
			return responseJSON(jsbridge.Response{Error: &jsbridge.ErrorDTO{Message: "missing request"}})
		}

		var request jsbridge.Request
		if err := json.Unmarshal([]byte(args[0].String()), &request); err != nil {
			return responseJSON(jsbridge.Response{Error: &jsbridge.ErrorDTO{Message: err.Error()}})
		}
		return responseJSON(jsbridge.Execute(request))
	})
	defer request.Release()

	js.Global().Set("postcssGoWasmRequest", request)

	// Main-thread instances additionally own handle sessions so browser plugin
	// callbacks read and mutate the Go AST without serializing it.
	handles, err := registerHandleExports()
	if err != nil {
		panic(err)
	}
	defer func() {
		for _, fn := range handles {
			fn.Release()
		}
	}()

	select {}
}

func responseJSON(response jsbridge.Response) string {
	encoded, err := jsbridge.ToJSON(response)
	if err != nil {
		fallback, _ := json.Marshal(jsbridge.Response{
			Error: &jsbridge.ErrorDTO{Message: err.Error()},
		})
		return string(fallback)
	}
	return string(encoded)
}
