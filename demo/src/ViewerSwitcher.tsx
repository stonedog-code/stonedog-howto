import type { ReactElement } from "react";

import { VIEWER_IDS, VIEWERS, type ViewerId } from "../shared/viewers";

export interface ViewerSwitcherProps {
  current: ViewerId;
  onSelect: (viewer: ViewerId) => void;
  seesUnrestricted: boolean;
  onToggleUnrestricted: (value: boolean) => void;
}

/**
 * Impersonation, for the demo only.
 *
 * The viewer travels to the server as a query parameter, which is exactly what
 * a real application must never do — there the reader's identity comes from the
 * session, and letting the client name its own audience is not an access
 * control at all. It is spelled out on the control itself rather than only in
 * the README, because a screenshot of this page travels further than its docs.
 */
export function ViewerSwitcher({
  current,
  onSelect,
  seesUnrestricted,
  onToggleUnrestricted,
}: ViewerSwitcherProps): ReactElement {
  return (
    <div className="switcher">
      <fieldset>
        <legend>Impersonate</legend>
        <div className="viewers">
          {VIEWER_IDS.map((id) => {
            const viewer = VIEWERS[id];
            return (
              <label key={id} className={id === current ? "viewer current" : "viewer"}>
                <input
                  type="radio"
                  name="viewer"
                  value={id}
                  checked={id === current}
                  onChange={() => onSelect(id)}
                />
                <span className="viewer-label">{viewer.label}</span>
                <span className="viewer-blurb">{viewer.blurb}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="unrestricted">
        <input
          type="checkbox"
          checked={seesUnrestricted}
          onChange={(event) => onToggleUnrestricted(event.target.checked)}
        />
        <span>
          Articles with no <code>roles</code> are readable
        </span>
      </label>

      <p className="caveat">
        Demo only. The reader’s identity belongs in the session; a client that
        names its own audience is not an access control.
      </p>
    </div>
  );
}
