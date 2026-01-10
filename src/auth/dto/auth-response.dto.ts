export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    userId: string;
    email: string;
    nickName: string;
    nickname: string;
    createdAt?: Date;
    updatedAt?: Date;
  };

  constructor(
    accessToken: string,
    user: {
      id: string;
      userId: string;
      email: string;
      nickName: string;
      nickname: string;
      createdAt?: Date;
      updatedAt?: Date;
    },
  ) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
