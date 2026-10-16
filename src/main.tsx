import { StrictMode, lazy, Suspense } from "react";
import { useRoute } from "./lib/navigation";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
const Demo = lazy(() =>
  import("./components/PublicDemo").then((m) => ({ default: m.PublicDemo })),
);
function Root() {
  const route = useRoute();
  return route.startsWith("/demo") ? (
    <Suspense fallback={<p>Loading demo…</p>}>
      <Demo />
    </Suspense>
  ) : (
    <App />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
