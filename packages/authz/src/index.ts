export type OrganizationRole = 'owner' | 'admin' | 'project_admin' | 'test_editor' | 'test_runner' | 'secret_user' | 'secret_admin' | 'runner_admin' | 'viewer';
export type Permission = 'organization.read' | 'project.write' | 'test.read' | 'test.write' | 'run.start' | 'runner.manage' | 'secret.read' | 'secret.write' | 'audit.read';

const permissionRoles: Record<Permission, OrganizationRole[]> = {
  'organization.read': ['owner', 'admin', 'project_admin', 'test_editor', 'test_runner', 'secret_user', 'secret_admin', 'runner_admin', 'viewer'],
  'project.write': ['owner', 'admin', 'project_admin'],
  'test.read': ['owner', 'admin', 'project_admin', 'test_editor', 'test_runner', 'viewer'],
  'test.write': ['owner', 'admin', 'project_admin', 'test_editor'],
  'run.start': ['owner', 'admin', 'project_admin', 'test_editor', 'test_runner'],
  'runner.manage': ['owner', 'admin', 'runner_admin'],
  'secret.read': ['owner', 'admin', 'secret_user', 'secret_admin'],
  'secret.write': ['owner', 'admin', 'secret_admin'],
  'audit.read': ['owner', 'admin'],
};

export function can(role: OrganizationRole, permission: Permission): boolean { return permissionRoles[permission].includes(role); }
export function assertCan(role: OrganizationRole, permission: Permission): void { if (!can(role, permission)) throw new Error(`role ${role} cannot ${permission}`); }
