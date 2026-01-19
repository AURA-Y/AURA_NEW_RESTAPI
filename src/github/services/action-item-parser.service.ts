import { Injectable, Logger } from '@nestjs/common';
import {
  ActionItem,
  ParsedActionItems,
} from '../interfaces/action-item.interface';

@Injectable()
export class ActionItemParserService {
  private readonly logger = new Logger(ActionItemParserService.name);

  /**
   * 마크다운 summary에서 액션 아이템 테이블 파싱
   *
   * 예시 입력:
   * ## 액션 아이템
   *
   * | 담당자 | 할 일 | 마감일 |
   * |-------|------|-------|
   * | 조명기 | STT 요청 부스팅 설정 | 기록된 내용 없음 |
   * | DongkyuLee | 구글 캘린더 예약 | 2026-01-25 |
   */
  parse(summary: string): ParsedActionItems {
    try {
      // "## 액션 아이템" 섹션 찾기
      const sectionRegex =
        /## 액션 아이템\s*\n\n?\|[^\n]+\|\s*\n\|[-|\s]+\|\s*\n((?:\|[^\n]+\|\s*\n?)+)/;
      const match = summary.match(sectionRegex);

      if (!match) {
        this.logger.debug('액션 아이템 섹션을 찾을 수 없습니다.');
        return { items: [], success: true, rawMarkdown: '' };
      }

      const tableContent = match[1];
      const rows = tableContent
        .split('\n')
        .filter((row) => row.trim().startsWith('|'));

      const items: ActionItem[] = rows
        .map((row) => this.parseTableRow(row))
        .filter((item): item is ActionItem => item !== null);

      this.logger.log(`${items.length}개의 액션 아이템 파싱 완료`);

      return {
        items,
        success: true,
        rawMarkdown: match[0],
      };
    } catch (error) {
      this.logger.error('액션 아이템 파싱 실패', error);
      return {
        items: [],
        success: false,
        rawMarkdown: '',
        error: error instanceof Error ? error.message : '파싱 오류',
      };
    }
  }

  /**
   * 마크다운 테이블 행 파싱
   * | 담당자 | 할 일 | 마감일 |
   */
  private parseTableRow(row: string): ActionItem | null {
    // | 로 분리하고 빈 셀 제거
    const cells = row
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);

    // 최소 2개 셀 필요 (담당자, 할 일)
    if (cells.length < 2) {
      return null;
    }

    const assignee = cells[0];
    const task = cells[1];
    const rawDueDate = cells[2] || null;

    // "기록된 내용 없음" 처리
    const dueDate =
      rawDueDate === '기록된 내용 없음' || rawDueDate === '-'
        ? null
        : rawDueDate;

    return {
      assignee,
      task,
      dueDate,
    };
  }
}
