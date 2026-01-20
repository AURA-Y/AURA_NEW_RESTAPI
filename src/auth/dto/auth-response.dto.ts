export class AuthResponseDto {
  accessToken: string;

  user: {
    id: string;
    userId: string;
    email: string;
    nickName: string;
    profileImage?: string | null; // 프로필 이미지 URL
    githubUsername?: string | null; // GitHub 사용자명
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
      githubUsername?: string | null;
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
