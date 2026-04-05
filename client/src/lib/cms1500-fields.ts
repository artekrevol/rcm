export const CMS1500_FIELDS: Record<string, [number, number]> = {
  insuranceTypeMedicare:     [44,  692],
  insuranceTypeMedicaid:     [94,  692],
  insuranceTypeTricare:      [140, 692],
  insuranceTypeChampva:      [186, 692],
  insuranceTypeGroupHealth:  [234, 692],
  insuranceTypeFeca:         [282, 692],
  insuranceTypeOther:        [320, 692],

  insuredIdNumber:           [378, 692],

  patientName:               [44,  668],

  patientDobMM:              [258, 668],
  patientDobDD:              [280, 668],
  patientDobYY:              [300, 668],
  patientSexMale:            [358, 668],
  patientSexFemale:          [390, 668],

  insuredName:               [378, 668],

  patientAddress:            [44,  644],
  patientCity:               [44,  622],
  patientState:              [190, 622],
  patientZip:                [228, 622],
  patientPhone:              [294, 622],

  relationshipSelf:          [378, 644],
  relationshipSpouse:        [408, 644],
  relationshipChild:         [442, 644],
  relationshipOther:         [476, 644],

  insuredAddress:            [378, 622],
  insuredCity:               [378, 600],
  insuredState:              [502, 600],
  insuredZip:                [378, 580],
  insuredPhone:              [450, 580],

  insuredGroupNumber:        [378, 548],

  insuredDobMM:              [378, 528],
  insuredDobDD:              [400, 528],
  insuredDobYY:              [420, 528],
  insuredSexMale:            [478, 528],
  insuredSexFemale:          [510, 528],

  patientSignature:          [44,  482],

  insuredSignature:          [378, 482],

  currentIllnessMM:          [44,  456],
  currentIllnessDD:          [68,  456],
  currentIllnessYY:          [90,  456],

  referringProviderName:     [190, 432],

  referringProviderNPI:      [404, 432],

  diagnosisA:                [44,  382],
  diagnosisB:                [162, 382],
  diagnosisC:                [44,  364],
  diagnosisD:                [162, 364],

  priorAuthNumber:           [378, 392],

  line1DateFrom:             [28,  330],
  line1DateTo:               [76,  330],
  line1PlaceOfService:       [150, 330],
  line1ProcedureCode:        [196, 330],
  line1Modifier:             [252, 330],
  line1DiagnosisPointer:     [302, 330],
  line1Charges:              [334, 330],
  line1Units:                [396, 330],
  line1NPI:                  [448, 330],

  line2DateFrom:             [28,  312],
  line2DateTo:               [76,  312],
  line2PlaceOfService:       [150, 312],
  line2ProcedureCode:        [196, 312],
  line2Modifier:             [252, 312],
  line2DiagnosisPointer:     [302, 312],
  line2Charges:              [334, 312],
  line2Units:                [396, 312],
  line2NPI:                  [448, 312],

  line3DateFrom:             [28,  294],
  line3DateTo:               [76,  294],
  line3PlaceOfService:       [150, 294],
  line3ProcedureCode:        [196, 294],
  line3Modifier:             [252, 294],
  line3DiagnosisPointer:     [302, 294],
  line3Charges:              [334, 294],
  line3Units:                [396, 294],
  line3NPI:                  [448, 294],

  line4DateFrom:             [28,  276],
  line4DateTo:               [76,  276],
  line4PlaceOfService:       [150, 276],
  line4ProcedureCode:        [196, 276],
  line4Modifier:             [252, 276],
  line4DiagnosisPointer:     [302, 276],
  line4Charges:              [334, 276],
  line4Units:                [396, 276],
  line4NPI:                  [448, 276],

  line5DateFrom:             [28,  258],
  line5DateTo:               [76,  258],
  line5PlaceOfService:       [150, 258],
  line5ProcedureCode:        [196, 258],
  line5Modifier:             [252, 258],
  line5DiagnosisPointer:     [302, 258],
  line5Charges:              [334, 258],
  line5Units:                [396, 258],
  line5NPI:                  [448, 258],

  line6DateFrom:             [28,  240],
  line6DateTo:               [76,  240],
  line6PlaceOfService:       [150, 240],
  line6ProcedureCode:        [196, 240],
  line6Modifier:             [252, 240],
  line6DiagnosisPointer:     [302, 240],
  line6Charges:              [334, 240],
  line6Units:                [396, 240],
  line6NPI:                  [448, 240],

  federalTaxId:              [44,  212],
  taxIdTypeEIN:              [130, 212],
  taxIdTypeSSN:              [148, 212],

  patientAccountNumber:      [190, 212],

  acceptAssignmentYes:       [302, 212],

  totalCharge:               [334, 212],

  amountPaid:                [400, 212],

  physicianSignature:        [44,  178],
  signatureDate:             [210, 178],

  serviceFacilityName:       [44,  154],
  serviceFacilityAddress:    [44,  140],
  serviceFacilityCityStateZip: [44, 126],
  serviceFacilityNPI:        [44,  108],

  billingProviderName:       [314, 154],
  billingProviderPhone:      [420, 154],
  billingProviderAddress:    [314, 140],
  billingProviderCityStateZip: [314, 126],
  billingProviderNPI:        [424, 108],
};
