// Match only the observed Android launcher dialog, never an application ANR.
export function pixelLauncherCloseControl(xml) {
  const nodes = (xml.match(/<node\b[^>]*>/g) ?? []).map((node) => ({
    node,
    attributes: Object.fromEntries(
      [...node.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    ),
  }));
  if (
    !nodes.some(
      ({ attributes }) =>
        attributes.text === "Pixel Launcher isn't responding" &&
        attributes["resource-id"] === "android:id/alertTitle" &&
        attributes.package === "android",
    )
  )
    return undefined;
  return nodes.find(
    ({ attributes }) =>
      attributes.text === "Close app" &&
      attributes["resource-id"] === "android:id/aerr_close" &&
      attributes.package === "android" &&
      attributes.enabled === "true",
  )?.node;
}
