/** The privileges the admin API's own handlers are gated on. */
export const ADMIN_USERS_READ = { verb: 'read', resource: 'admin/users' }
export const ADMIN_USERS_WRITE = { verb: 'write', resource: 'admin/users' }
/** Reference data, not tenant data -- see listRoles.ts. */
export const ADMIN_ROLES_READ = { verb: 'read', resource: 'admin/roles' }
