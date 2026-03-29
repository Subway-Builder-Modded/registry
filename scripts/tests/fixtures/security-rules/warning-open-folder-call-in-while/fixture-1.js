export function triggerOpenFolderInWhile() {
  const openFolder = openModsFolder;
  while (true) {
    openFolder();
    break;
  }
}
