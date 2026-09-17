package main

import "github.com/kandev/kandev/pkg/pluginsdk"

// promptHistoryPlugin implements pluginsdk.Plugin by embedding
// UnimplementedPlugin and overriding no RPCs. The browser conversation facade
// reads the active session's conversation through the Host, so the backend
// needs no plugin logic: every event is accepted and every webhook returns
// the unhandled 404.
type promptHistoryPlugin struct {
	pluginsdk.UnimplementedPlugin
}

var _ pluginsdk.Plugin = (*promptHistoryPlugin)(nil)
