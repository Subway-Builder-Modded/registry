export async function validateGitHubRepo(repo: string): Promise<string[]> {
  const errors: string[] = [];
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // 1. Check repo exists
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!repoRes.ok) {
    errors.push(`**github-repo**: Repository \`${repo}\` does not exist or is not accessible.`);
    return errors;
  }

  // 2. Check releases exist
  const releasesRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=1`, { headers });
  const releases = await releasesRes.json();
  if (!Array.isArray(releases) || releases.length === 0) {
    errors.push(`**github-repo**: Repository \`${repo}\` has no releases. Create at least one release with a .zip asset.`);
    return errors;
  }

  // 3. Check latest release has a .zip asset
  const assets: { name: string }[] = releases[0].assets || [];
  const hasZip = assets.some((a) => a.name.endsWith(".zip"));
  if (!hasZip) {
    errors.push(`**github-repo**: Latest release in \`${repo}\` has no .zip asset. Upload a .zip file to your release.`);
  }

  return errors;
}
