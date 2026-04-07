/**
 * colorMatcher.ts
 * 使用 culori 库实现专业色彩匹配：
 * - CIEDE2000 (ΔE2000) 色差公式，比原来手写的 CIE76 精确得多
 * - culori v4 的 differenceCiede2000 完全支持 Lab、OKLab、sRGB 等色彩空间，精度经过大量验证
 */
import { differenceCiede2000, converter } from 'culori';

export interface MarkColor {
  code: string;
  name: string;
  hex: string;
}

/** Mark 拼豆色卡（与前端 markPalette.ts 保持同步） */
const MARK_COLOR_PALETTE: MarkColor[] = [
  { code: 'ZG1', name: 'ZG1', hex: '#DAABB3' },
  { code: 'ZG2', name: 'ZG2', hex: '#D6AA87' },
  { code: 'ZG3', name: 'ZG3', hex: '#C1B08D' },
  { code: 'ZG4', name: 'ZG4', hex: '#86B69F' },
  { code: 'ZG5', name: 'ZG5', hex: '#B49DC6' },
  { code: 'ZG6', name: 'ZG6', hex: '#94BFE2' },
  { code: 'ZG7', name: 'ZG7', hex: '#E2A9D2' },
  { code: 'ZG8', name: 'ZG8', hex: '#AB91C0' },
  { code: 'A1', name: 'A1', hex: '#FAF4C8' },
  { code: 'A2', name: 'A2', hex: '#FFFFD5' },
  { code: 'A3', name: 'A3', hex: '#FEFF8B' },
  { code: 'A4', name: 'A4', hex: '#FBED56' },
  { code: 'A5', name: 'A5', hex: '#F4D738' },
  { code: 'A6', name: 'A6', hex: '#FEAC4C' },
  { code: 'A7', name: 'A7', hex: '#FE8B4C' },
  { code: 'A8', name: 'A8', hex: '#FFDA45' },
  { code: 'A9', name: 'A9', hex: '#FF995B' },
  { code: 'A10', name: 'A10', hex: '#F77C31' },
  { code: 'A11', name: 'A11', hex: '#FFDD99' },
  { code: 'A12', name: 'A12', hex: '#FE9F72' },
  { code: 'A13', name: 'A13', hex: '#FFC365' },
  { code: 'A14', name: 'A14', hex: '#FD543D' },
  { code: 'A15', name: 'A15', hex: '#FFF365' },
  { code: 'A16', name: 'A16', hex: '#FFFF9F' },
  { code: 'A17', name: 'A17', hex: '#FFE36E' },
  { code: 'A18', name: 'A18', hex: '#FEBE7D' },
  { code: 'A19', name: 'A19', hex: '#FD7C72' },
  { code: 'A20', name: 'A20', hex: '#FFD568' },
  { code: 'A21', name: 'A21', hex: '#FFE395' },
  { code: 'A22', name: 'A22', hex: '#F4F57D' },
  { code: 'A23', name: 'A23', hex: '#E6C9B7' },
  { code: 'A24', name: 'A24', hex: '#F7F8A2' },
  { code: 'A25', name: 'A25', hex: '#FFD67D' },
  { code: 'A26', name: 'A26', hex: '#FFC830' },
  { code: 'B1', name: 'B1', hex: '#E6EE31' },
  { code: 'B2', name: 'B2', hex: '#63F347' },
  { code: 'B3', name: 'B3', hex: '#9EF780' },
  { code: 'B4', name: 'B4', hex: '#5DE035' },
  { code: 'B5', name: 'B5', hex: '#35E352' },
  { code: 'B6', name: 'B6', hex: '#65E2A6' },
  { code: 'B7', name: 'B7', hex: '#3DAF80' },
  { code: 'B8', name: 'B8', hex: '#1C9C4F' },
  { code: 'B9', name: 'B9', hex: '#27523A' },
  { code: 'B10', name: 'B10', hex: '#95D3C2' },
  { code: 'B11', name: 'B11', hex: '#5D722A' },
  { code: 'B12', name: 'B12', hex: '#166F41' },
  { code: 'B13', name: 'B13', hex: '#CAEB7B' },
  { code: 'B14', name: 'B14', hex: '#ADE946' },
  { code: 'B15', name: 'B15', hex: '#2E5132' },
  { code: 'B16', name: 'B16', hex: '#C5ED9C' },
  { code: 'B17', name: 'B17', hex: '#9BB13A' },
  { code: 'B18', name: 'B18', hex: '#6EE449' },
  { code: 'B19', name: 'B19', hex: '#24B88C' },
  { code: 'B20', name: 'B20', hex: '#2CF0CC' },
  { code: 'B21', name: 'B21', hex: '#156A6B' },
  { code: 'B22', name: 'B22', hex: '#0B3C43' },
  { code: 'B23', name: 'B23', hex: '#303A21' },
  { code: 'B24', name: 'B24', hex: '#EEFCA5' },
  { code: 'B25', name: 'B25', hex: '#4E846D' },
  { code: 'B26', name: 'B26', hex: '#8D7A35' },
  { code: 'B27', name: 'B27', hex: '#CCE1AF' },
  { code: 'B28', name: 'B28', hex: '#9EE5B9' },
  { code: 'B29', name: 'B29', hex: '#C5E254' },
  { code: 'B30', name: 'B30', hex: '#E2FCB1' },
  { code: 'B31', name: 'B31', hex: '#B0E792' },
  { code: 'B32', name: 'B32', hex: '#9CAB5A' },
  { code: 'C1', name: 'C1', hex: '#E8FFE7' },
  { code: 'C2', name: 'C2', hex: '#A9F9FC' },
  { code: 'C3', name: 'C3', hex: '#A0E2FB' },
  { code: 'C4', name: 'C4', hex: '#41CCFF' },
  { code: 'C5', name: 'C5', hex: '#01ACEB' },
  { code: 'C6', name: 'C6', hex: '#50AAF0' },
  { code: 'C7', name: 'C7', hex: '#3677D2' },
  { code: 'C8', name: 'C8', hex: '#0F54C0' },
  { code: 'C9', name: 'C9', hex: '#324BCA' },
  { code: 'C10', name: 'C10', hex: '#3EBCF2' },
  { code: 'C11', name: 'C11', hex: '#28DDDE' },
  { code: 'C12', name: 'C12', hex: '#1C334D' },
  { code: 'C13', name: 'C13', hex: '#CDE8FF' },
  { code: 'C14', name: 'C14', hex: '#D5FDFF' },
  { code: 'C15', name: 'C15', hex: '#22C4C6' },
  { code: 'C16', name: 'C16', hex: '#1557A8' },
  { code: 'C17', name: 'C17', hex: '#04D1F6' },
  { code: 'C18', name: 'C18', hex: '#1D3344' },
  { code: 'C19', name: 'C19', hex: '#1887A2' },
  { code: 'C20', name: 'C20', hex: '#176DAF' },
  { code: 'C21', name: 'C21', hex: '#BEDDFF' },
  { code: 'C22', name: 'C22', hex: '#67B4BE' },
  { code: 'C23', name: 'C23', hex: '#C8E2FF' },
  { code: 'C24', name: 'C24', hex: '#7CC4FF' },
  { code: 'C25', name: 'C25', hex: '#A9E5E5' },
  { code: 'C26', name: 'C26', hex: '#3CAED8' },
  { code: 'C27', name: 'C27', hex: '#D3DFFA' },
  { code: 'C28', name: 'C28', hex: '#BBCFED' },
  { code: 'C29', name: 'C29', hex: '#34488E' },
  { code: 'D1', name: 'D1', hex: '#AEB4F2' },
  { code: 'D2', name: 'D2', hex: '#858EDD' },
  { code: 'D3', name: 'D3', hex: '#2F54AF' },
  { code: 'D4', name: 'D4', hex: '#182A84' },
  { code: 'D5', name: 'D5', hex: '#B843C5' },
  { code: 'D6', name: 'D6', hex: '#AC7BDE' },
  { code: 'D7', name: 'D7', hex: '#8B54B3' },
  { code: 'D8', name: 'D8', hex: '#E2D3FF' },
  { code: 'D9', name: 'D9', hex: '#D5B9F8' },
  { code: 'D10', name: 'D10', hex: '#361851' },
  { code: 'D11', name: 'D11', hex: '#B9BAE1' },
  { code: 'D12', name: 'D12', hex: '#DE9AD4' },
  { code: 'D13', name: 'D13', hex: '#B90095' },
  { code: 'D14', name: 'D14', hex: '#88279B' },
  { code: 'D15', name: 'D15', hex: '#2F1F90' },
  { code: 'D16', name: 'D16', hex: '#C4D4F6' },
  { code: 'D17', name: 'D17', hex: '#C4D4F6' },
  { code: 'D18', name: 'D18', hex: '#A45EC7' },
  { code: 'D19', name: 'D19', hex: '#DBC3D7' },
  { code: 'D20', name: 'D20', hex: '#9C32B2' },
  { code: 'D21', name: 'D21', hex: '#9A009B' },
  { code: 'D22', name: 'D22', hex: '#333A95' },
  { code: 'D23', name: 'D23', hex: '#EBDAFC' },
  { code: 'D24', name: 'D24', hex: '#7786E5' },
  { code: 'D25', name: 'D25', hex: '#494FC7' },
  { code: 'D26', name: 'D26', hex: '#DFC2F8' },
  { code: 'E1', name: 'E1', hex: '#FDD3CC' },
  { code: 'E2', name: 'E2', hex: '#FEC0DF' },
  { code: 'E3', name: 'E3', hex: '#FFB7E7' },
  { code: 'E4', name: 'E4', hex: '#E6849E' },
  { code: 'E5', name: 'E5', hex: '#F551A2' },
  { code: 'E6', name: 'E6', hex: '#F13D74' },
  { code: 'E7', name: 'E7', hex: '#C63478' },
  { code: 'E8', name: 'E8', hex: '#FFDBE9' },
  { code: 'E9', name: 'E9', hex: '#E970CC' },
  { code: 'E10', name: 'E10', hex: '#D33793' },
  { code: 'E11', name: 'E11', hex: '#FCDDD2' },
  { code: 'E12', name: 'E12', hex: '#F78FC3' },
  { code: 'E13', name: 'E13', hex: '#B5006D' },
  { code: 'E14', name: 'E14', hex: '#FFD1BA' },
  { code: 'E15', name: 'E15', hex: '#F8C7C9' },
  { code: 'E16', name: 'E16', hex: '#FFF3EB' },
  { code: 'E17', name: 'E17', hex: '#FFE2EA' },
  { code: 'E18', name: 'E18', hex: '#FFC7DB' },
  { code: 'E19', name: 'E19', hex: '#FEBAD5' },
  { code: 'E20', name: 'E20', hex: '#D8C7D1' },
  { code: 'E21', name: 'E21', hex: '#BD9DA1' },
  { code: 'E22', name: 'E22', hex: '#B785A1' },
  { code: 'E23', name: 'E23', hex: '#937A8D' },
  { code: 'E24', name: 'E24', hex: '#E1BCE8' },
  { code: 'F1', name: 'F1', hex: '#FD957B' },
  { code: 'F2', name: 'F2', hex: '#FC3D46' },
  { code: 'F3', name: 'F3', hex: '#F74941' },
  { code: 'F4', name: 'F4', hex: '#FC283C' },
  { code: 'F5', name: 'F5', hex: '#E7002F' },
  { code: 'F6', name: 'F6', hex: '#943630' },
  { code: 'F7', name: 'F7', hex: '#971937' },
  { code: 'F8', name: 'F8', hex: '#BC0028' },
  { code: 'F9', name: 'F9', hex: '#E2677A' },
  { code: 'F10', name: 'F10', hex: '#8A4526' },
  { code: 'F11', name: 'F11', hex: '#5A2121' },
  { code: 'F12', name: 'F12', hex: '#FD4E6A' },
  { code: 'F13', name: 'F13', hex: '#F35744' },
  { code: 'F14', name: 'F14', hex: '#FFA9AD' },
  { code: 'F15', name: 'F15', hex: '#D30022' },
  { code: 'F16', name: 'F16', hex: '#FEC2A6' },
  { code: 'F17', name: 'F17', hex: '#E69C79' },
  { code: 'F18', name: 'F18', hex: '#D37C46' },
  { code: 'F19', name: 'F19', hex: '#C1444A' },
  { code: 'F20', name: 'F20', hex: '#CD9391' },
  { code: 'F21', name: 'F21', hex: '#F7B4C6' },
  { code: 'F22', name: 'F22', hex: '#FDC0D0' },
  { code: 'F23', name: 'F23', hex: '#F67E66' },
  { code: 'F24', name: 'F24', hex: '#E69BAA' },
  { code: 'F25', name: 'F25', hex: '#E54B4F' },
  { code: 'G1', name: 'G1', hex: '#FFE2CE' },
  { code: 'G2', name: 'G2', hex: '#FFC4AA' },
  { code: 'G3', name: 'G3', hex: '#F4C3A5' },
  { code: 'G4', name: 'G4', hex: '#E1B383' },
  { code: 'G5', name: 'G5', hex: '#EDB045' },
  { code: 'G6', name: 'G6', hex: '#E99C17' },
  { code: 'G7', name: 'G7', hex: '#9D5B3E' },
  { code: 'G8', name: 'G8', hex: '#753B32' },
  { code: 'G9', name: 'G9', hex: '#E6B483' },
  { code: 'G10', name: 'G10', hex: '#D88C39' },
  { code: 'G11', name: 'G11', hex: '#C0C593' },
  { code: 'G12', name: 'G12', hex: '#FFC890' },
  { code: 'G13', name: 'G13', hex: '#87714A' },
  { code: 'G14', name: 'G14', hex: '#8D614C' },
  { code: 'G15', name: 'G15', hex: '#FCF9E0' },
  { code: 'G16', name: 'G16', hex: '#F2D9BA' },
  { code: 'G17', name: 'G17', hex: '#7B524B' },
  { code: 'G18', name: 'G18', hex: '#FFE4CC' },
  { code: 'G19', name: 'G19', hex: '#E07935' },
  { code: 'G20', name: 'G20', hex: '#A94023' },
  { code: 'G21', name: 'G21', hex: '#B88558' },
  { code: 'H1', name: 'H1', hex: '#DFFBFF' },
  { code: 'H2', name: 'H2', hex: '#FFFFFF' },
  { code: 'H3', name: 'H3', hex: '#66B1BA' },
  { code: 'H4', name: 'H4', hex: '#89858C' },
  { code: 'H5', name: 'H5', hex: '#48464E' },
  { code: 'H6', name: 'H6', hex: '#2F2B2F' },
  { code: 'H7', name: 'H7', hex: '#000000' },
  { code: 'H8', name: 'H8', hex: '#E7D6DB' },
  { code: 'H9', name: 'H9', hex: '#EDEDED' },
  { code: 'H10', name: 'H10', hex: '#EEE9EA' },
  { code: 'H11', name: 'H11', hex: '#CECDD5' },
  { code: 'H12', name: 'H12', hex: '#FFF5ED' },
  { code: 'H13', name: 'H13', hex: '#F5ECD2' },
  { code: 'H14', name: 'H14', hex: '#CFD7D3' },
  { code: 'H15', name: 'H15', hex: '#98A6A8' },
  { code: 'H16', name: 'H16', hex: '#1D1414' },
  { code: 'H17', name: 'H17', hex: '#F1EDED' },
  { code: 'H18', name: 'H18', hex: '#FFFDF0' },
  { code: 'H19', name: 'H19', hex: '#F6EFE2' },
  { code: 'H20', name: 'H20', hex: '#949FA3' },
  { code: 'H21', name: 'H21', hex: '#FFFBE1' },
  { code: 'H22', name: 'H22', hex: '#CACAD4' },
  { code: 'H23', name: 'H23', hex: '#9A9D94' },
  { code: 'M1', name: 'M1', hex: '#BCC6B8' },
  { code: 'M2', name: 'M2', hex: '#AAA386' },
  { code: 'M3', name: 'M3', hex: '#697D80' },
  { code: 'M4', name: 'M4', hex: '#E3D2BC' },
  { code: 'M5', name: 'M5', hex: '#D0CCAA' },
  { code: 'M6', name: 'M6', hex: '#B0A782' },
  { code: 'M7', name: 'M7', hex: '#84A497' },
  { code: 'M8', name: 'M8', hex: '#B38281' },
  { code: 'M9', name: 'M9', hex: '#A58767' },
  { code: 'M10', name: 'M10', hex: '#C5B2BC' },
  { code: 'M11', name: 'M11', hex: '#FF7594' },
  { code: 'M12', name: 'M12', hex: '#644749' },
  { code: 'M13', name: 'M13', hex: '#D19066' },
  { code: 'M14', name: 'M14', hex: '#C77362' },
  { code: 'M15', name: 'M15', hex: '#757D7B' },
  { code: 'P1', name: 'P1', hex: '#FCF7F8' },
  { code: 'P2', name: 'P2', hex: '#B0A9AC' },
  { code: 'P3', name: 'P3', hex: '#AFDCAB' },
  { code: 'P4', name: 'P4', hex: '#FEA49F' },
  { code: 'P5', name: 'P5', hex: '#EEBC3E' },
  { code: 'P6', name: 'P6', hex: '#5FD0A7' },
  { code: 'P7', name: 'P7', hex: '#EB9270' },
  { code: 'P8', name: 'P8', hex: '#9DD958' },
  { code: 'P9', name: 'P9', hex: '#9D9D9D' },
  { code: 'P10', name: 'P10', hex: '#D9C7EA' },
  { code: 'P11', name: 'P11', hex: '#F3ECC9' },
  { code: 'P12', name: 'P12', hex: '#66EEF2' },
  { code: 'P13', name: 'P13', hex: '#AACBEF' },
  { code: 'P14', name: 'P14', hex: '#3376B0' },
  { code: 'P15', name: 'P15', hex: '#668575' },
  { code: 'P16', name: 'P16', hex: '#EEBF45' },
  { code: 'P17', name: 'P17', hex: '#FEA324' },
  { code: 'P18', name: 'P18', hex: '#FEB99F' },
  { code: 'P19', name: 'P19', hex: '#FFE0E9' },
  { code: 'P20', name: 'P20', hex: '#FEBECF' },
  { code: 'P21', name: 'P21', hex: '#ECBEBF' },
  { code: 'P22', name: 'P22', hex: '#E4A89F' },
  { code: 'P23', name: 'P23', hex: '#A56268' },
  { code: 'Q1', name: 'Q1', hex: '#F2A5E8' },
  { code: 'Q2', name: 'Q2', hex: '#9EEC91' },
  { code: 'Q3', name: 'Q3', hex: '#FFFF00' },
  { code: 'Q4', name: 'Q4', hex: '#FFEBFA' },
  { code: 'Q5', name: 'Q5', hex: '#76CEDE' },
  { code: 'R1', name: 'R1', hex: '#D50D21' },
  { code: 'R2', name: 'R2', hex: '#F92F83' },
  { code: 'R3', name: 'R3', hex: '#FD8324' },
  { code: 'R4', name: 'R4', hex: '#8EC31E' },
  { code: 'R5', name: 'R5', hex: '#35C75B' },
  { code: 'R6', name: 'R6', hex: '#23B891' },
  { code: 'R7', name: 'R7', hex: '#19779D' },
  { code: 'R8', name: 'R8', hex: '#1A60C3' },
  { code: 'R9', name: 'R9', hex: '#9A56B4' },
  { code: 'R10', name: 'R10', hex: '#FFDB4C' },
  { code: 'R11', name: 'R11', hex: '#FFEBFA' },
  { code: 'R12', name: 'R12', hex: '#D8D5CE' },
  { code: 'R13', name: 'R13', hex: '#55514C' },
  { code: 'R14', name: 'R14', hex: '#9FE4DF' },
  { code: 'R15', name: 'R15', hex: '#77CEE9' },
  { code: 'R16', name: 'R16', hex: '#3ECFCA' },
  { code: 'R17', name: 'R17', hex: '#4AB67A' },
  { code: 'R18', name: 'R18', hex: '#7CD9DD' },
  { code: 'R19', name: 'R19', hex: '#CDE55D' },
  { code: 'R20', name: 'R20', hex: '#E8C7B4' },
  { code: 'R21', name: 'R21', hex: '#AD6F3C' },
  { code: 'R22', name: 'R22', hex: '#6C372F' },
  { code: 'R23', name: 'R23', hex: '#FEB872' },
  { code: 'R24', name: 'R24', hex: '#F3C1C0' },
  { code: 'R25', name: 'R25', hex: '#C9675E' },
  { code: 'R26', name: 'R26', hex: '#D293BE' },
  { code: 'R27', name: 'R27', hex: '#EA8CB1' },
  { code: 'R28', name: 'R28', hex: '#9C87D6' },
  { code: 'T1', name: 'T1', hex: '#FFFFFF' },
  { code: 'Y1', name: 'Y1', hex: '#FD6FB4' },
  { code: 'Y2', name: 'Y2', hex: '#FEB481' },
  { code: 'Y3', name: 'Y3', hex: '#D7FAA0' },
  { code: 'Y4', name: 'Y4', hex: '#BDBFFA' },
  { code: 'Y5', name: 'Y5', hex: '#E987EA' },
];

// culori 的 converter 和 differenceDe2000
const toRgb = converter('rgb');

// CIEDE2000 差值函数（culori 返回 ΔE2000，范围约 0-100）
const de2000 = differenceCiede2000();

/** 将 hex 颜色转换为 culori RGB 对象 */
function hexToRgbObj(hex: string) {
  return toRgb(hex)!;
}

/** 预计算色板的 culori RGB 表示，避免每次匹配时重复转换 */
const PALETTE_WITH_RGB = MARK_COLOR_PALETTE.map((color) => ({
  ...color,
  rgbObj: hexToRgbObj(color.hex),
}));

export interface LegendSampleInput {
  code: string;
  sampledHex: string;
}

/**
 * 使用 CIEDE2000 找到最接近的颜色
 * CIEDE2000 在感知均匀性上远优于前端原来的 CIE76（平方欧氏距离），
 * 对于人眼难以区分的颜色对（如肤色系），准确率显著提升
 *
 * @param r 0-255
 * @param g 0-255
 * @param b 0-255
 * @param legendSamples 可选：用户手动标注的图例样本，优先匹配
 */
export function findNearestColor(
  r: number, g: number, b: number,
  legendSamples: LegendSampleInput[] = [],
): { code: string; hex: string } {
  const input = { mode: 'rgb' as const, r: r / 255, g: g / 255, b: b / 255 };

  // 优先在图例样本中匹配
  if (legendSamples.length > 0) {
    let minDist = Infinity;
    let bestSample = legendSamples[0];
    for (const s of legendSamples) {
      const sampleRgb = toRgb(s.sampledHex);
      if (!sampleRgb) continue;
      const d = de2000(input, sampleRgb);
      if (d < minDist) { minDist = d; bestSample = s; }
    }
    // 如果图例样本匹配足够好（ΔE < 25），使用图例颜色
    if (minDist < 25) {
      return { code: bestSample.code, hex: bestSample.sampledHex };
    }
  }

  // 在色板中找最近颜色（CIEDE2000）
  let minDist = Infinity;
  let best = PALETTE_WITH_RGB[0];
  for (const p of PALETTE_WITH_RGB) {
    const d = de2000(input, p.rgbObj);
    if (d < minDist) { minDist = d; best = p; }
  }

  return { code: best.code, hex: best.hex };
}
