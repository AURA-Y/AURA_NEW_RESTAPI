import { Injectable, Logger } from '@nestjs/common';

/**
 * 파싱된 액션 아이템
 */
export interface ParsedActionItem {
  assignee: string; // 담당자 닉네임
  task: string; // 할 일
  dueDate: string | null; // 기한 (YYYY-MM-DD 또는 null)
}

/**
 * ActionItemParserService
 *
 * 회의록(report.md)에서 액션 아이템을 파싱하는 서비스
 *
 * 지원 형식:
 * 1. 마크다운 테이블 형식
 * 2. 리스트 형식
 */
@Injectable()
export class ActionItemParserService {
  private readonly logger = new Logger(ActionItemParserService.name);

  /**
   * 마크다운 내용에서 액션 아이템 파싱
   *
   * @param markdownContent - 회의록 마크다운 내용
   * @returns 파싱된 액션 아이템 배열
   *
   * 지원 형식:
   *
   * 1. 테이블 형식:
   * | 담당자 | 할 일 | 기한 |
   * |--------|-------|------|
   * | 김철수 | API 설계 | 2026-01-25 |
   *
   * 2. 리스트 형식:
   * - 김철수: API 설계 (2026-01-25)
   * - 박영희: 프론트엔드 구현
   */
  parse(markdownContent: string): ParsedActionItem[] {
    const items: ParsedActionItem[] = [];

    // "액션 아이템" 또는 "Action Item" 섹션 찾기
    const sectionRegex =
      /##\s*(?:\d+\.\s*)?(?:액션\s*아이템|Action\s*Items?)\s*\n([\s\S]*?)(?=\n##\s|\n---|\n\*\*\*|$)/i;
    const sectionMatch = markdownContent.match(sectionRegex);

    if (!sectionMatch) {
      this.logger.debug('No action items section found');
      return items;
    }

    const sectionContent = sectionMatch[1];

    // 테이블 형식 파싱 시도
    const tableItems = this.parseTable(sectionContent);
    if (tableItems.length > 0) {
      this.logger.log(`Parsed ${tableItems.length} action items from table`);
      return tableItems;
    }

    // 리스트 형식 파싱 시도
    const listItems = this.parseList(sectionContent);
    if (listItems.length > 0) {
      this.logger.log(`Parsed ${listItems.length} action items from list`);
      return listItems;
    }

    this.logger.debug('No action items found in section');
    return items;
  }

  /**
   * 테이블 형식 파싱
   *
   * | 담당자 | 할 일 | 기한 |
   * |--------|-------|------|
   * | 김철수 | API 설계 | 2026-01-25 |
   */
  private parseTable(content: string): ParsedActionItem[] {
    const items: ParsedActionItem[] = [];

    // 테이블 행 찾기 (헤더와 구분선 제외)
    const lines = content.split('\n');
    let inTable = false;
    let headerPassed = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // 테이블 시작 감지
      if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
        inTable = true;

        // 구분선인지 확인 (|---|---|---| 또는 |:---|:---:|---:|)
        // 파이프 제거 후 남은 문자가 대시, 콜론, 공백만 있으면 구분선
        const withoutPipes = trimmedLine.replace(/\|/g, '');
        if (/^[\s\-:]+$/.test(withoutPipes) && withoutPipes.includes('-')) {
          headerPassed = true;
          continue;
        }

        // 헤더 행 건너뛰기
        if (!headerPassed) {
          continue;
        }

        // 데이터 행 파싱
        const cells = trimmedLine
          .split('|')
          .slice(1, -1) // 앞뒤 빈 셀 제거
          .map((cell) => cell.trim());

        if (cells.length >= 2) {
          const assignee = cells[0];
          const task = cells[1];
          const dueDate = cells[2] || null;

          // 유효한 데이터인지 확인
          if (assignee && task && assignee !== '-' && task !== '-') {
            items.push({
              assignee,
              task,
              dueDate: this.normalizeDueDate(dueDate),
            });
          }
        }
      } else if (inTable) {
        // 테이블 종료
        break;
      }
    }

    return items;
  }

  /**
   * 리스트 형식 파싱
   *
   * - 김철수: API 설계 (2026-01-25)
   * - 박영희: 프론트엔드 구현
   * - [ ] 이민수 - 테스트 작성
   */
  private parseList(content: string): ParsedActionItem[] {
    const items: ParsedActionItem[] = [];

    // 리스트 항목 패턴들
    const patterns = [
      // "- 담당자: 할 일 (기한)" 형식
      /^[-*]\s*(?:\[[ x]\]\s*)?(.+?):\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/,
      // "- 담당자 - 할 일 (기한)" 형식
      /^[-*]\s*(?:\[[ x]\]\s*)?(.+?)\s*[-–]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/,
      // "- 담당자님이 할 일을 합니다" 형식 (자연어)
      /^[-*]\s*(?:\[[ x]\]\s*)?(.+?)(?:님이?|씨가?|가|이)\s+(.+?)(?:합니다|해야\s*합니다|할\s*예정).*$/,
    ];

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      for (const pattern of patterns) {
        const match = trimmedLine.match(pattern);
        if (match) {
          const assignee = match[1].trim();
          const task = match[2].trim();
          const dueDate = match[3] || null;

          if (assignee && task) {
            items.push({
              assignee,
              task,
              dueDate: this.normalizeDueDate(dueDate),
            });
          }
          break;
        }
      }
    }

    return items;
  }

  /**
   * 날짜 형식 정규화
   *
   * @param dateStr - 다양한 형식의 날짜 문자열
   * @returns YYYY-MM-DD 형식 또는 null
   */
  private normalizeDueDate(dateStr: string | null): string | null {
    if (!dateStr || dateStr === '-' || dateStr.trim() === '') {
      return null;
    }

    const trimmed = dateStr.trim();

    // YYYY-MM-DD 형식 확인
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // YYYY/MM/DD 형식
    const slashMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (slashMatch) {
      return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;
    }

    // MM월 DD일 형식 (현재 연도 사용)
    const koreanMatch = trimmed.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (koreanMatch) {
      const year = new Date().getFullYear();
      const month = koreanMatch[1].padStart(2, '0');
      const day = koreanMatch[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // 파싱 불가능한 경우 원본 반환 시도
    try {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch {
      // 파싱 실패
    }

    return null;
  }
}
