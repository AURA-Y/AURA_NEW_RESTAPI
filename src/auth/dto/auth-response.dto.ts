export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    email: string;
    nickName: string;
    roomReportIdxList?: string[];
  };

  constructor(
    accessToken: string,
    user: {
      id: string;
      email: string;
      nickName: string;
      roomReportIdxList?: string[];
    },
  ) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
