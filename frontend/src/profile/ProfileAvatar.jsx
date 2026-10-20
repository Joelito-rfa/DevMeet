import { useState } from "react";

import { frameClass } from "./decorations";
import { initialsFor, profileStatus } from "./profileMeta";

/**
 * Avatar réel : image distante si elle charge, initiales sinon. Le cadre est
 * un anneau extérieur (padding) qui ne recouvre jamais le visage.
 */
function ProfileAvatar({
  user,
  frame = null,
  size = "lg",
  showStatus = true,
  className = "",
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const imageUrl = user?.avatarUrl || "";
  const status = profileStatus(user?.status);
  const hasImage = Boolean(imageUrl) && imageUrl !== failedUrl;

  return (
    <span
      className={`pf-avatar pf-avatar--${size}${
        frame ? " has-frame" : ""
      } ${frameClass(frame)} ${className}`.trim()}
    >
      <span className="pf-avatar-inner">
        {hasImage ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedUrl(imageUrl)}
          />
        ) : (
          <span className="pf-avatar-initials" aria-hidden="true">
            {initialsFor(user?.name)}
          </span>
        )}
      </span>

      {showStatus ? (
        <span
          className={`pf-avatar-status ${status.tone}`}
          title={status.label}
          aria-label={status.label}
        />
      ) : null}
    </span>
  );
}

export default ProfileAvatar;
