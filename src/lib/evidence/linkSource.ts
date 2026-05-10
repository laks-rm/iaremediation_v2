/**
 * Detects the source type of a URL based on its domain pattern
 */
export function detectLinkSource(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Google Drive / Docs / Sheets
    if (
      hostname.includes("drive.google.com") ||
      hostname.includes("docs.google.com") ||
      hostname.includes("sheets.google.com")
    ) {
      return "google_drive";
    }

    // Slack
    if (hostname.includes("slack.com")) {
      return "slack";
    }

    // Confluence
    if (hostname.includes("atlassian.net") && url.includes("/wiki")) {
      return "confluence";
    }

    if (hostname.includes("confluence.com")) {
      return "confluence";
    }

    // Notion
    if (hostname.includes("notion.so") || hostname.includes("notion.site")) {
      return "notion";
    }

    // Jira
    if (hostname.includes("atlassian.net") && url.includes("/browse")) {
      return "jira";
    }

    if (hostname.includes("jira.com")) {
      return "jira";
    }

    // HubSpot
    if (hostname.includes("hubspot.com") || hostname.includes("app.hubspot.com")) {
      return "hubspot";
    }

    // Salesforce
    if (hostname.includes("salesforce.com") || hostname.includes("lightning.force.com")) {
      return "salesforce";
    }

    // GitHub
    if (hostname.includes("github.com")) {
      return "github";
    }

    // Figma
    if (hostname.includes("figma.com")) {
      return "figma";
    }

    // YouTube
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }

    // Loom
    if (hostname.includes("loom.com")) {
      return "loom";
    }

    // Zoom
    if (hostname.includes("zoom.us")) {
      return "zoom";
    }

    // Microsoft Teams
    if (hostname.includes("teams.microsoft.com")) {
      return "teams";
    }

    return "other";
  } catch {
    return "other";
  }
}

/**
 * Gets a human-readable label for a link source type
 */
export function getLinkSourceLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    google_drive: "Google Drive",
    slack: "Slack",
    confluence: "Confluence",
    notion: "Notion",
    jira: "Jira",
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    github: "GitHub",
    figma: "Figma",
    youtube: "YouTube",
    loom: "Loom",
    zoom: "Zoom",
    teams: "Microsoft Teams",
    other: "External Link",
  };

  return labels[sourceType] ?? "External Link";
}

/**
 * Validates a URL for use as evidence
 * Returns null if valid, error message if invalid
 */
export function validateEvidenceUrl(url: string): string | null {
  // Must be a non-empty string
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return "URL is required";
  }

  const trimmed = url.trim();

  // Must be a valid URL
  let urlObj: URL;
  try {
    urlObj = new URL(trimmed);
  } catch {
    return "Invalid URL format";
  }

  // Must use HTTPS (security requirement)
  if (urlObj.protocol !== "https:") {
    return "URL must use HTTPS";
  }

  // Block dangerous schemes (should not be possible with https check, but belt and suspenders)
  const dangerousSchemes = ["javascript:", "data:", "file:", "vbscript:"];
  if (dangerousSchemes.some((scheme) => trimmed.toLowerCase().startsWith(scheme))) {
    return "Dangerous URL scheme detected";
  }

  // Block localhost and private IP ranges (security)
  const hostname = urlObj.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
  ) {
    return "Links to local or private networks are not allowed";
  }

  return null;
}
