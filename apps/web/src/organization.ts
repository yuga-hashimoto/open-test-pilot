export function getOrganizationDisplayName(organization: { name?: string } | undefined): string {
  const name = organization?.name?.trim();
  return name === undefined || name.length === 0 ? "Workspace" : name;
}
