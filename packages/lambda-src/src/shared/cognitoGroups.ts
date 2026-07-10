import {
  AdminAddUserToGroupCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

export interface AssignBaselineGroupsParams {
  userPoolId: string
  username: string
  groups: string[]
  cognitoClient: CognitoIdentityProviderClient
}

/** Adds a newly-confirmed user to each configured baseline Cognito group. */
export async function assignBaselineGroups(
  params: AssignBaselineGroupsParams,
): Promise<void> {
  const { userPoolId, username, groups, cognitoClient } = params

  for (const groupName of groups) {
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: groupName,
      }),
    )
  }
}
