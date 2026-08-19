const { widget } = figma;
const {
  Text,
  Frame,
  AutoLayout,
  Rectangle,
  Span,
  Ellipse,
  Input,
  useSyncedState,
  useEffect,
  usePropertyMenu,
  useWidgetNodeId,
  waitForTask,
} = widget;

type SpecField = {
  key: string;
  label: string;
  placeholder: string;
};

const FIELDS: SpecField[] = [
  { key: "purpose", label: "Purpose", placeholder: "What is this interface for?" },
  { key: "actions", label: "Actions / Interactions", placeholder: "What can the user do?" },
  { key: "states", label: "States", placeholder: "Empty, loading, error, hover, etc." },
  { key: "rules", label: "Rules", placeholder: "Validation, logic, constraints." },
  { key: "data", label: "Data requirements", placeholder: "Fields, sources, formats." },
  { key: "navigation", label: "Navigation", placeholder: "How users move through it." },
  { key: "acceptance", label: "Acceptance criteria", placeholder: "Definition of done." },
];

type Spec = { nodeId: string } & { [key: string]: string };

function Widget() {
  const [nodeId, setNodeId] = useSyncedState<string>("nodeId", "");
  const [values, setValues] = useSyncedState<{ [key: string]: string }>("values", {});
  const [serverUrl, setServerUrl] = useSyncedState<string>("serverUrl", "");
  const [status, setStatus] = useSyncedState<string>("status", "");
  const [publishing, setPublishing] = useSyncedState<boolean>("publishing", false);
  const widgetId = useWidgetNodeId();

  useEffect(() => {
    if (!nodeId) {
      waitForTask(
        figma.getNodeByIdAsync(widgetId).then((widgetNode) => {
          if (widgetNode && widgetNode.parent) {
            const parent = widgetNode.parent;
            if (parent.type !== "PAGE") setNodeId(parent.id);
          }
        })
      );
    }
  });

  const setValue = (key: string) => (v: string) => setValues({ ...values, [key]: v });

  const buildSpec = (): Spec => {
    const spec: Spec = { nodeId };
    for (const f of FIELDS) spec[f.key] = values[f.key] ?? "";
    return spec;
  };

  const publish = () => {
    if (!serverUrl.trim()) {
      setStatus("Set the server URL first.");
      return;
    }
    setPublishing(true);
    setStatus("Publishing…");
    const base = serverUrl.trim().replace(/\/+$/, "");
    waitForTask(
      fetch(`${base}/api/specs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSpec()),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setStatus(`Published — spec ${data.id}`);
        })
        .catch((err: Error) => setStatus(`Failed: ${err.message}`))
        .finally(() => setPublishing(false))
    );
  };

  return (
    <AutoLayout
      direction="vertical"
      spacing={10}
      padding={16}
      width={360}
      fill="#FFFFFF"
      cornerRadius={8}
      stroke="#E5E5E5"
    >
      <Text fontSize={16} fontWeight={700} fill="#1E1E1E">
        Product Spec
      </Text>
      <Text fontSize={11} fill="#8A8A8A">
        Fill in the spec for the attached frame/section, then publish to the MCP server.
      </Text>

      <AutoLayout direction="vertical" spacing={4} width="fill-parent">
        <Text fontSize={11} fontWeight={700} fill="#4A5568">
          Node ID
        </Text>
        <Input
          value={nodeId}
          onTextEditEnd={(e) => setNodeId(e.characters)}
          placeholder="Auto-detected from attached node…"
          fontSize={12}
          fill="#1E1E1E"
          width="fill-parent"
        />
      </AutoLayout>

      {FIELDS.map((f) => (
        <AutoLayout key={f.key} direction="vertical" spacing={4} width="fill-parent">
          <Text fontSize={11} fontWeight={700} fill="#4A5568">
            {f.label}
          </Text>
          <Input
            value={values[f.key] ?? ""}
            onTextEditEnd={(e) => setValue(f.key)(e.characters)}
            placeholder={f.placeholder}
            inputBehavior="multiline"
            fontSize={12}
            fill="#1E1E1E"
            width="fill-parent"
          />
        </AutoLayout>
      ))}

      <AutoLayout direction="vertical" spacing={4} width="fill-parent">
        <Text fontSize={11} fontWeight={700} fill="#4A5568">
          MCP Server URL
        </Text>
        <Input
          value={serverUrl}
          onTextEditEnd={(e) => setServerUrl(e.characters)}
          placeholder="https://your-app.up.railway.app"
          fontSize={12}
          fill="#1E1E1E"
          width="fill-parent"
        />
      </AutoLayout>

      <AutoLayout direction="horizontal" spacing={8} width="fill-parent" verticalAlignItems="center">
        <Text
          fontSize={13}
          fontWeight={700}
          fill={publishing ? "#B0B0B0" : "#D97757"}
          onClick={publishing ? undefined : publish}
        >
          {publishing ? "Publishing…" : "Publish"}
        </Text>
        {status && (
          <Text fontSize={11} fill="#4A5568">
            {status}
          </Text>
        )}
      </AutoLayout>
    </AutoLayout>
  );
}

widget.register(Widget);