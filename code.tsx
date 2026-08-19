const { widget } = figma;
const { Text, Frame, AutoLayout, Rectangle, Span, Ellipse, Input, useSyncedState, useEffect, usePropertyMenu, waitForTask } = widget;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

type Message = { role: "user" | "assistant"; content: string };

function Widget() {
  const [messages, setMessages] = useSyncedState<Message[]>("messages", []);
  const [draft, setDraft] = useSyncedState<string>("draft", "");
  const [apiKey, setApiKey] = useSyncedState<string>("apiKey", "");
  const [loading, setLoading] = useSyncedState<boolean>("loading", false);

  usePropertyMenu(
    [
      {
        itemType: "action",
        tooltip: "Clear conversation",
        propertyName: "clear",
      },
    ],
    ({ propertyName }) => {
      if (propertyName === "clear") setMessages([]);
    }
  );

  async function ask(text: string) {
    if (!apiKey) {
      figma.notify("Paste your Anthropic API key in the widget field first.");
      return;
    }
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply: string = data.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("");
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      figma.notify(`Claude request failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const send = () => {
    if (draft.trim()) {
      const text = draft.trim();
      setDraft("");
      waitForTask(ask(text));
    }
  };

  return (
    <AutoLayout direction="vertical" spacing={12} padding={16} width={320} fill="#FFFFFF" cornerRadius={8} stroke="#E5E5E5">
      <Text fontSize={16} fontWeight={700} fill="#1E1E1E">
        Claude Chat
      </Text>
      <AutoLayout direction="vertical" spacing={8} width="fill-parent">
        {messages.length === 0 && (
          <Text fontSize={12} fill="#8A8A8A">
            Ask a question to get started.
          </Text>
        )}
        {messages.map((m, i) => (
          <AutoLayout key={i} direction="vertical" spacing={4} width="fill-parent">
            <Text fontSize={11} fontWeight={700} fill={m.role === "user" ? "#D97757" : "#4A5568"}>
              {m.role === "user" ? "You" : "Claude"}
            </Text>
            <Text fontSize={12} fill="#1E1E1E">
              {m.content}
            </Text>
          </AutoLayout>
        ))}
        {loading && (
          <Text fontSize={12} fill="#8A8A8A">
            Claude is thinking…
          </Text>
        )}
      </AutoLayout>
      <AutoLayout direction="horizontal" spacing={8} width="fill-parent" verticalAlignItems="center">
        <Input
          value={draft}
          onTextEditEnd={(v) => {
            setDraft(v.characters);
            send();
          }}
          placeholder="Message Claude…"
          fontSize={13}
          fill="#1E1E1E"
          width="fill-parent"
        />
        <Text fontSize={13} fontWeight={700} fill="#D97757" onClick={send}>
          Send
        </Text>
      </AutoLayout>
      <Input
        value={apiKey}
        onTextEditEnd={(v) => setApiKey(v.characters)}
        placeholder="Anthropic API key…"
        fontSize={11}
        fill="#8A8A8A"
        width="fill-parent"
      />
    </AutoLayout>
  );
}

widget.register(Widget);