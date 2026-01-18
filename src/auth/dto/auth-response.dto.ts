export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    userId: string;
    email: string;
    nickName: string;
    profileImage?: string | null; // 프로필 이미지 URL
    roomReportIdxList?: string[];
    createdAt?: Date;
    updatedAt?: Date;
    googleConnected?: boolean;
  };

  constructor(
    accessToken: string,
    user: {
      id: string;
      userId: string;
      email: string;
      nickName: string;
      profileImage?: string | null;
      roomReportIdxList?: string[];
      createdAt?: Date;
      updatedAt?: Date;
      googleConnected?: boolean;
    },
  ) {
    this.accessToken = accessToken;
    this.user = user;
  }
}
