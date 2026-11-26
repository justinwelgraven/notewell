import { useEffect, useState } from "react";
import { extraReadings, heightReadings, layoutMode } from "../lib/viewport";
import { isTauri } from "../lib/storage";

/**
 * Small "About / Screen info" block at the bottom of the settings menu: which build is running,
 * and (web) the screen sizes the browser reports — handy for sorting out iPhone Duo layout issues.
 */
export default function ScreenInfo() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const r = heightReadings();
  const x = extraReadings();
  const app = document.querySelector(".app")?.getBoundingClientRect();
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="screen-info">
      <div>Build {__BUILD__}</div>
      {!isTauri && (
        <div>
          {standalone ? "Home Screen app" : "Browser tab"} · {r.portrait ? "portrait" : "landscape"} · width {r.width}
          <br />
          heights: app {app ? Math.round(app.height) : "?"} · inner {r.inner} · client {r.client} · visual {r.visual ?? "–"} · screen {x.screen}
          <br />
          css: vh {x.vh} · svh {x.svh} · lvh {x.lvh} · dvh {x.dvh} · safe top {x.safeTop} · bottom {x.safeBottom} · layout {layoutMode()}
        </div>
      )}
    </div>
  );
}
