export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    email: string;
    nickName: string;
  };

  constructor(
    accessToken: string,
    user: {
      id: string;
      email: string;
      nickName: string;
    },
  ) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
