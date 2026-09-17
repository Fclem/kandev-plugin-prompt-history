// Command kandev-plugin-prompt-history is the backend half of this kandev
// plugin. It implements pluginsdk.Plugin (see plugin.go) and is spawned by
// kandev as a gRPC subprocess — there is no HTTP server, no listen address,
// and no secrets to configure: pluginsdk.Serve owns the entire transport.
//
// Its only job is the go-plugin handshake. The browser conversation facade
// needs no plugin backend logic, so promptHistoryPlugin overrides no RPCs.
package main

import "github.com/kandev/kandev/pkg/pluginsdk"

func main() {
	pluginsdk.Serve(&promptHistoryPlugin{})
}
