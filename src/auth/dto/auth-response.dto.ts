export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    username: string;
    name: string;
  };

  constructor(accessToken: string, user: { id: string; username: string; name: string }) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
