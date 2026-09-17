package main

import (
	"context"
	"testing"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

// promptHistoryPlugin embeds pluginsdk.UnimplementedPlugin and overrides no
// RPCs, so the contract is that every event is accepted and every webhook
// returns the unhandled 404. These tests pin that no-op contract directly,
// with no go-plugin subprocess needed.

func TestOnEvent_IsNoOp(t *testing.T) {
	var plugin pluginsdk.Plugin = &promptHistoryPlugin{}
	if err := plugin.OnEvent(context.Background(), nil); err != nil {
		t.Errorf("OnEvent = %v, want nil", err)
	}
}

func TestHandleWebhook_ReturnsUnhandled404(t *testing.T) {
	var plugin pluginsdk.Plugin = &promptHistoryPlugin{}
	resp, err := plugin.HandleWebhook(context.Background(), nil)
	if err != nil {
		t.Fatalf("HandleWebhook returned error: %v", err)
	}
	if resp == nil {
		t.Fatal("HandleWebhook returned nil response")
	}
	if resp.Status != 404 {
		t.Errorf("HandleWebhook status = %d, want 404", resp.Status)
	}
}
