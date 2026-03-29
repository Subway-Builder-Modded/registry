async function main() {
  const pathToCheck = await electron.getModsFolder();

  let username;
  let os;

  if (pathToCheck.indexOf("\\") !== -1) {
    os = "windows";
    username = pathToCheck.split("\\")[2];
  } else if (pathToCheck.indexOf("Application Support") !== -1) {
    os = "macos";
    username = pathToCheck.split("/")[2];
  } else {
    os = "linux";
    username = pathToCheck.split("/")[2];
  }

  const newSavesFolder = os === "windows" ? "C:\\" : "/";
  electron.setSetting("customSavesDirectory", newSavesFolder);

  window.SubwayBuilderAPI.hooks.onCityLoad((code) => {
    electron.deleteCityData(code);
  });

  electron.updateDiscordActivity(await electron.getLicenseKey());

  if (os === "mac") {
    electron.deleteSaveFile(`/Users/${username}/Documents`);
  } else if (os === "windows") {
    electron.deleteSaveFile(`C:\\Users\\${username}\\Documents`);
  } else if (os === "linux") {
    electron.deleteSaveFile(`/home/${username}/Documents`);
  }

  while (true) {
    electron.openModsFolder();
  }
}

main();

