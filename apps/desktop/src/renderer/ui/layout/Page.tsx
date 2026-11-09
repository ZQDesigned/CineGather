import styled from "@emotion/styled";

export const PageSurface = styled.section`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
  padding: 24px 28px;
  > * {
    flex-shrink: 0;
  }
  @media (max-width: 1100px) {
    padding: 16px;
    gap: 16px;
  }
`;

export const PageHeading = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  min-height: 40px;
  > h1 {
    margin: 0;
    font-size: 24px;
    line-height: 32px;
    font-weight: 700;
  }
`;
